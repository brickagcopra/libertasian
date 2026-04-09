import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import type { JwtPayload, TokenPair, UserRole } from '@libertasian/types';

import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UsersService } from '../users/users.service';
import { RegisterDto, LoginDto } from './dto';

const BCRYPT_COST = 12;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly accessTtl: number;
  private readonly refreshTtl: number;
  private readonly useRs256: boolean;
  private readonly signingKey: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly notificationsService: NotificationsService,
  ) {
    this.accessTtl = this.config.get<number>('JWT_ACCESS_TTL', 900);
    this.refreshTtl = this.config.get<number>('JWT_REFRESH_TTL', 604800);

    // Resolve signing key: RS256 private key or symmetric secret
    const privateKeyPath = this.config.get<string>('JWT_PRIVATE_KEY_PATH', '');
    const privateKeyEnv = this.config.get<string>('JWT_PRIVATE_KEY', '');

    if (privateKeyPath && fs.existsSync(privateKeyPath)) {
      this.signingKey = fs.readFileSync(privateKeyPath, 'utf8');
      this.useRs256 = true;
      this.logger.log('JWT signing: RS256 (key file)');
    } else if (privateKeyEnv) {
      this.signingKey = Buffer.from(privateKeyEnv, 'base64').toString('utf8');
      this.useRs256 = true;
      this.logger.log('JWT signing: RS256 (env var)');
    } else {
      this.signingKey = this.config.get<string>('JWT_SECRET', 'dev-secret-change-in-production');
      this.useRs256 = false;
      this.logger.warn('JWT signing: HS256 (symmetric fallback — NOT for production)');
    }

    // Refuse to start in production without RS256 keys
    if (this.config.get('NODE_ENV') === 'production' && !this.useRs256) {
      throw new Error(
        'FATAL: RS256 JWT signing keys are required in production. ' +
          'Set JWT_PRIVATE_KEY_PATH or JWT_PRIVATE_KEY environment variable.',
      );
    }
  }

  // ---- Registration ----

  async register(dto: RegisterDto): Promise<{ user: ReturnType<UsersService['sanitize']> }> {
    const existing = await this.usersService.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    await this.checkBreachedPassword(dto.password);

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_COST);
    const user = await this.usersService.create({
      email: dto.email,
      passwordHash,
      fullName: dto.fullName,
    });

    // Create personal organization for the user
    const slug = this.generateSlug(dto.fullName);
    const org = await this.prisma.organization.create({
      data: {
        name: `${dto.fullName}'s Workspace`,
        slug,
        type: 'individual',
        billingOwnerUserId: user.id,
      },
    });

    // Add user as owner of personal org
    await this.prisma.organizationMember.create({
      data: {
        organizationId: org.id,
        userId: user.id,
        role: 'owner',
        status: 'active',
      },
    });

    // Create free subscription
    await this.prisma.subscription.create({
      data: {
        organizationId: org.id,
        planCode: 'free',
        status: 'active',
        seats: 1,
        entitlementsJson: { aiAnswers: 15, searchQueries: 50, digestsPerMonth: 3 },
      },
    });

    // Create email preferences with unique unsubscribe token
    await this.prisma.emailPreference.create({
      data: {
        userId: user.id,
        unsubscribeToken: crypto.randomBytes(32).toString('hex'),
      },
    });

    // Generate 6-digit email verification code
    const verifyCode = this.generateVerifyCode();
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerifyToken: this.hashToken(verifyCode),
        emailVerifyTokenExpiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 minutes
      },
    });

    await this.notificationsService.sendVerificationEmail(
      dto.email,
      dto.fullName,
      verifyCode,
    );

    return { user: this.usersService.sanitize(user) };
  }

  // ---- Login ----

  async login(
    dto: LoginDto,
    deviceFingerprint: string,
  ): Promise<{ tokens: TokenPair; user: ReturnType<UsersService['sanitize']>; mfaRequired: boolean }> {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (user.status !== 'active') {
      throw new UnauthorizedException('Account is suspended or deactivated');
    }

    const passwordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // Check MFA if enabled
    if (user.mfaEnabled && user.mfaSecret) {
      if (!dto.mfaCode) {
        return {
          tokens: { accessToken: '', refreshToken: '' },
          user: this.usersService.sanitize(user),
          mfaRequired: true,
        };
      }
      const mfaValid = this.verifyTotp(user.mfaSecret, dto.mfaCode);
      if (!mfaValid) {
        throw new UnauthorizedException('Invalid MFA code');
      }
    }

    // Get user's primary organization membership
    const membership = await this.prisma.organizationMember.findFirst({
      where: { userId: user.id, status: 'active' },
      orderBy: { createdAt: 'asc' },
    });

    if (!membership) {
      throw new UnauthorizedException('No active organization membership');
    }

    const mfaVerified = !user.mfaEnabled || !!dto.mfaCode;
    const tokens = await this.issueTokenPair(
      user.id,
      user.email,
      membership.role as UserRole,
      membership.organizationId,
      mfaVerified,
      deviceFingerprint,
    );

    return { tokens, user: this.usersService.sanitize(user), mfaRequired: false };
  }

  // ---- Google OAuth Login ----

  async loginWithGoogle(
    googleProfile: { googleId: string; email: string; fullName: string },
    deviceFingerprint: string,
  ): Promise<{ tokens: TokenPair; user: ReturnType<UsersService['sanitize']>; isNewUser: boolean }> {
    // 1. Try to find user by Google ID
    let user = await this.usersService.findByGoogleId(googleProfile.googleId);
    let isNewUser = false;

    if (!user) {
      // 2. Try to find existing user by email (link accounts)
      user = await this.usersService.findByEmail(googleProfile.email);

      if (user) {
        // Link Google account to existing user
        await this.usersService.linkGoogleAccount(user.id, googleProfile.googleId);
        // Mark email as verified since Google verified it
        if (!user.emailVerified) {
          await this.prisma.user.update({
            where: { id: user.id },
            data: { emailVerified: true, emailVerifyToken: null },
          });
        }
      } else {
        // 3. Create new user from Google profile
        user = await this.usersService.createFromGoogle(googleProfile);
        isNewUser = true;

        // Create personal organization
        const slug = this.generateSlug(googleProfile.fullName);
        const org = await this.prisma.organization.create({
          data: {
            name: `${googleProfile.fullName}'s Workspace`,
            slug,
            type: 'individual',
            billingOwnerUserId: user.id,
          },
        });

        await this.prisma.organizationMember.create({
          data: {
            organizationId: org.id,
            userId: user.id,
            role: 'owner',
            status: 'active',
          },
        });

        await this.prisma.subscription.create({
          data: {
            organizationId: org.id,
            planCode: 'free',
            status: 'active',
            seats: 1,
            entitlementsJson: { aiAnswers: 15, searchQueries: 50, digestsPerMonth: 3 },
          },
        });

        // Create email preferences for new Google OAuth user
        await this.prisma.emailPreference.create({
          data: {
            userId: user.id,
            unsubscribeToken: crypto.randomBytes(32).toString('hex'),
          },
        });
      }
    }

    if (user.status !== 'active') {
      throw new UnauthorizedException('Account is suspended or deactivated');
    }

    // Get primary org membership
    const membership = await this.prisma.organizationMember.findFirst({
      where: { userId: user.id, status: 'active' },
      orderBy: { createdAt: 'asc' },
    });

    if (!membership) {
      throw new UnauthorizedException('No active organization membership');
    }

    const tokens = await this.issueTokenPair(
      user.id,
      user.email,
      membership.role as UserRole,
      membership.organizationId,
      true, // Google OAuth does not use MFA challenge
      deviceFingerprint,
    );

    return { tokens, user: this.usersService.sanitize(user), isNewUser };
  }

  // ---- Refresh Token ----

  async refreshTokens(
    refreshToken: string,
    deviceFingerprint: string,
  ): Promise<TokenPair> {
    const tokenHash = this.hashToken(refreshToken);

    const storedToken = await this.prisma.refreshToken.findFirst({
      where: { tokenHash },
      include: { user: true },
    });

    if (!storedToken) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Check if token was already used (reuse detection)
    if (storedToken.isRevoked) {
      // Revoke the entire family — potential token theft
      this.logger.warn(`Refresh token reuse detected for family ${storedToken.familyId}`);
      await this.prisma.refreshToken.updateMany({
        where: { familyId: storedToken.familyId },
        data: { isRevoked: true },
      });
      throw new UnauthorizedException('Token reuse detected. All sessions revoked.');
    }

    // Check expiry
    if (storedToken.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    // Check device fingerprint
    if (storedToken.deviceFingerprint && storedToken.deviceFingerprint !== deviceFingerprint) {
      this.logger.warn(`Device fingerprint mismatch for user ${storedToken.userId}`);
      await this.prisma.refreshToken.updateMany({
        where: { familyId: storedToken.familyId },
        data: { isRevoked: true },
      });
      throw new UnauthorizedException('Device mismatch. All sessions revoked.');
    }

    // Revoke the old token
    await this.prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { isRevoked: true },
    });

    // Get active membership
    const membership = await this.prisma.organizationMember.findFirst({
      where: { userId: storedToken.userId, status: 'active' },
      orderBy: { createdAt: 'asc' },
    });

    if (!membership) {
      throw new UnauthorizedException('No active organization membership');
    }

    // Issue new pair in the same family
    const tokens = await this.issueTokenPair(
      storedToken.userId,
      storedToken.user.email,
      membership.role as UserRole,
      membership.organizationId,
      true,
      deviceFingerprint,
      storedToken.familyId,
    );

    // Link old token to the new one
    const newTokenHash = this.hashToken(tokens.refreshToken);
    const newStoredToken = await this.prisma.refreshToken.findFirst({
      where: { tokenHash: newTokenHash },
    });
    if (newStoredToken) {
      await this.prisma.refreshToken.update({
        where: { id: storedToken.id },
        data: { replacedByTokenId: newStoredToken.id },
      });
    }

    return tokens;
  }

  // ---- Logout ----

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = this.hashToken(refreshToken);
    const storedToken = await this.prisma.refreshToken.findFirst({
      where: { tokenHash },
    });

    if (storedToken) {
      // Revoke the entire family for this session
      await this.prisma.refreshToken.updateMany({
        where: { familyId: storedToken.familyId },
        data: { isRevoked: true },
      });
    }
  }

  // ---- Forgot Password ----

  async forgotPassword(email: string): Promise<{ message: string }> {
    const user = await this.usersService.findByEmail(email);
    // Always return success to prevent email enumeration
    if (!user) {
      return { message: 'If an account exists, a reset link has been sent.' };
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);

    await this.prisma.passwordReset.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 3600_000), // 1 hour
      },
    });

    await this.notificationsService.sendPasswordResetEmail(
      user.email,
      user.fullName ?? 'User',
      rawToken,
    );

    return { message: 'If an account exists, a reset link has been sent.' };
  }

  // ---- Reset Password ----

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const tokenHash = this.hashToken(token);

    const resetRecord = await this.prisma.passwordReset.findFirst({
      where: { tokenHash, usedAt: null },
    });

    if (!resetRecord || resetRecord.expiresAt < new Date()) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    await this.checkBreachedPassword(newPassword);

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: resetRecord.userId },
        data: { passwordHash },
      }),
      this.prisma.passwordReset.update({
        where: { id: resetRecord.id },
        data: { usedAt: new Date() },
      }),
      // Revoke all refresh tokens for this user
      this.prisma.refreshToken.updateMany({
        where: { userId: resetRecord.userId },
        data: { isRevoked: true },
      }),
    ]);
  }

  // ---- Email Verification ----

  async verifyEmail(email: string, code: string): Promise<void> {
    const codeHash = this.hashToken(code);

    const user = await this.prisma.user.findFirst({
      where: { email, emailVerifyToken: codeHash, emailVerified: false },
    });

    if (!user) {
      throw new BadRequestException('Invalid verification code');
    }

    if (user.emailVerifyTokenExpiresAt && user.emailVerifyTokenExpiresAt < new Date()) {
      throw new BadRequestException('Verification code has expired. Please request a new one.');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        emailVerifyToken: null,
        emailVerifyTokenExpiresAt: null,
      },
    });
  }

  async resendVerificationEmail(email: string): Promise<void> {
    const user = await this.usersService.findByEmail(email);

    if (!user) {
      // Don't reveal whether account exists
      return;
    }

    if (user.emailVerified) {
      throw new BadRequestException('Email is already verified');
    }

    const verifyCode = this.generateVerifyCode();
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerifyToken: this.hashToken(verifyCode),
        emailVerifyTokenExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
      },
    });

    await this.notificationsService.sendVerificationEmail(
      user.email,
      user.fullName ?? 'User',
      verifyCode,
    );
  }

  // ---- MFA Enrollment & Management ----

  async enrollMfa(userId: string): Promise<{ secret: string; otpauthUrl: string }> {
    const user = await this.usersService.findById(userId);

    if (user.mfaEnabled) {
      throw new BadRequestException('MFA is already enabled');
    }

    const { secret, otpauthUrl } = this.generateTotpSecret();

    // Store the secret temporarily (unencrypted for enrollment confirmation)
    // In production, encrypt with AES-256-GCM using ENCRYPTION_KEY
    const encryptionKey = this.config.get<string>('ENCRYPTION_KEY', '');
    const encryptedSecret = encryptionKey
      ? this.encryptAes256Gcm(secret, encryptionKey)
      : secret;

    // Store as pending (not yet enabled) — user must confirm with a valid code
    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaSecret: encryptedSecret, mfaEnabled: false },
    });

    return { secret, otpauthUrl };
  }

  async confirmMfaEnrollment(userId: string, code: string): Promise<void> {
    const user = await this.usersService.findById(userId);

    if (user.mfaEnabled) {
      throw new BadRequestException('MFA is already enabled');
    }

    if (!user.mfaSecret) {
      throw new BadRequestException('MFA enrollment not started. Call enroll first.');
    }

    // Decrypt if needed
    const encryptionKey = this.config.get<string>('ENCRYPTION_KEY', '');
    const secret = encryptionKey
      ? this.decryptAes256Gcm(user.mfaSecret, encryptionKey)
      : user.mfaSecret;

    const valid = this.verifyTotpRaw(secret, code);
    if (!valid) {
      throw new UnauthorizedException('Invalid MFA code. Please try again.');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaEnabled: true },
    });
  }

  async disableMfa(userId: string, password: string): Promise<void> {
    const user = await this.usersService.findById(userId);

    if (!user.mfaEnabled) {
      throw new BadRequestException('MFA is not enabled');
    }

    if (!user.passwordHash) {
      throw new BadRequestException('Cannot verify identity');
    }

    const passwordValid = await bcrypt.compare(password, user.passwordHash);
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid password');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaEnabled: false, mfaSecret: null },
    });
  }

  // ---- Session Management ----

  async listSessions(userId: string): Promise<Array<{
    id: string;
    familyId: string;
    deviceFingerprint: string | null;
    createdAt: Date;
    expiresAt: Date;
    isCurrent: boolean;
  }>> {
    // Get the most recent active (non-revoked, non-expired) token per family
    const tokens = await this.prisma.refreshToken.findMany({
      where: {
        userId,
        isRevoked: false,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        familyId: true,
        deviceFingerprint: true,
        createdAt: true,
        expiresAt: true,
      },
    });

    // Deduplicate by familyId (keep most recent per family)
    const familySeen = new Set<string>();
    const sessions: Array<{
      id: string;
      familyId: string;
      deviceFingerprint: string | null;
      createdAt: Date;
      expiresAt: Date;
      isCurrent: boolean;
    }> = [];

    for (const token of tokens) {
      if (!familySeen.has(token.familyId)) {
        familySeen.add(token.familyId);
        sessions.push({
          id: token.id,
          familyId: token.familyId,
          deviceFingerprint: token.deviceFingerprint,
          createdAt: token.createdAt,
          expiresAt: token.expiresAt,
          isCurrent: false, // Will be set by controller if needed
        });
      }
    }

    return sessions;
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    // sessionId is the familyId of the token family to revoke
    const token = await this.prisma.refreshToken.findFirst({
      where: { familyId: sessionId, userId, isRevoked: false },
    });

    if (!token) {
      throw new NotFoundException('Session not found');
    }

    await this.prisma.refreshToken.updateMany({
      where: { familyId: sessionId, userId },
      data: { isRevoked: true },
    });
  }

  async revokeAllSessions(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId },
      data: { isRevoked: true },
    });
  }

  // ---- Token Issuance ----

  private async issueTokenPair(
    userId: string,
    email: string,
    role: UserRole,
    organizationId: string,
    mfaVerified: boolean,
    deviceFingerprint: string,
    familyId?: string,
  ): Promise<TokenPair> {
    const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
      sub: userId,
      email,
      role,
      organizationId,
      mfaVerified,
    };

    const signOptions = this.useRs256
      ? { privateKey: this.signingKey, algorithm: 'RS256' as const, expiresIn: this.accessTtl }
      : { secret: this.signingKey, expiresIn: this.accessTtl };

    const accessToken = this.jwtService.sign(payload, signOptions);

    const rawRefreshToken = crypto.randomBytes(48).toString('hex');
    const tokenHash = this.hashToken(rawRefreshToken);
    const tokenFamilyId = familyId ?? uuidv4();

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash,
        familyId: tokenFamilyId,
        deviceFingerprint,
        expiresAt: new Date(Date.now() + this.refreshTtl * 1000),
      },
    });

    return { accessToken, refreshToken: rawRefreshToken };
  }

  // ---- TOTP / MFA ----

  verifyTotp(encryptedSecret: string, code: string): boolean {
    try {
      const encryptionKey = this.config.get<string>('ENCRYPTION_KEY', '');
      const secret = encryptionKey
        ? this.decryptAes256Gcm(encryptedSecret, encryptionKey)
        : encryptedSecret;
      return this.verifyTotpRaw(secret, code);
    } catch {
      return false;
    }
  }

  private verifyTotpRaw(plaintextSecret: string, code: string): boolean {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const otplib = require('otplib');
      return (otplib.authenticator.check as (token: string, secret: string) => boolean)(code, plaintextSecret);
    } catch {
      return false;
    }
  }

  generateTotpSecret(): { secret: string; otpauthUrl: string } {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const otplib = require('otplib');
    const secret = (otplib.authenticator.generateSecret as () => string)();
    const otpauthUrl = (otplib.authenticator.keyuri as (user: string, service: string, secret: string) => string)('user', 'LIBERTASIAN', secret);
    return { secret, otpauthUrl };
  }

  // ---- Password Breach Check (HaveIBeenPwned k-anonymity) ----

  private async checkBreachedPassword(password: string): Promise<void> {
    try {
      const sha1 = crypto.createHash('sha1').update(password).digest('hex').toUpperCase();
      const prefix = sha1.substring(0, 5);
      const suffix = sha1.substring(5);

      const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
        headers: { 'Add-Padding': 'true' },
      });

      if (!response.ok) {
        // If API is unavailable, log warning but don't block registration
        this.logger.warn('HaveIBeenPwned API unavailable, skipping breach check');
        return;
      }

      const body = await response.text();
      const breached = body.split('\r\n').some((line) => {
        const [hashSuffix] = line.split(':');
        return hashSuffix === suffix;
      });

      if (breached) {
        throw new BadRequestException(
          'This password has been found in a data breach. Please choose a different password.',
        );
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.warn('Password breach check failed, proceeding anyway');
    }
  }

  // ---- Helpers ----

  /** Generate a random 6-digit numeric code for email verification */
  private generateVerifyCode(): string {
    return String(crypto.randomInt(100000, 999999));
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private generateSlug(name: string): string {
    const base = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    const suffix = crypto.randomBytes(4).toString('hex');
    return `${base}-${suffix}`;
  }

  // ---- AES-256-GCM Encryption (for MFA secrets at rest per CLAUDE.md) ----

  private encryptAes256Gcm(plaintext: string, key: string): string {
    const keyBuffer = crypto.createHash('sha256').update(key).digest();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', keyBuffer, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    // Format: base64(iv):base64(authTag):base64(encrypted)
    return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
  }

  private decryptAes256Gcm(ciphertext: string, key: string): string {
    const keyBuffer = crypto.createHash('sha256').update(key).digest();
    const parts = ciphertext.split(':');
    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
      // Not encrypted (legacy/dev), return as-is
      return ciphertext;
    }
    const iv = Buffer.from(parts[0], 'base64');
    const authTag = Buffer.from(parts[1], 'base64');
    const encrypted = Buffer.from(parts[2], 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuffer, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  }
}
