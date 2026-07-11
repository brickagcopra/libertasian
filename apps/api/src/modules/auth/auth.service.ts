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
import type { Request } from 'express';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import type { JwtPayload, TokenPair, UserRole } from '@libertasian/types';

import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PermissionsService } from '../rbac/permissions.service';
import { UsersService } from '../users/users.service';
import { RegisterDto, LoginDto } from './dto';
import { LoginEventService, type LoginEventType } from './login-event.service';
import { LoginThrottleService } from './login-throttle.service';

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
    private readonly loginEvents: LoginEventService,
    private readonly permissions: PermissionsService,
    private readonly loginThrottle: LoginThrottleService,
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

    // Warn in production without RS256 keys
    if (this.config.get('NODE_ENV') === 'production' && !this.useRs256) {
      this.logger.warn(
        'SECURITY WARNING: RS256 JWT signing keys are strongly recommended for production. ' +
          'Set JWT_PRIVATE_KEY_PATH or JWT_PRIVATE_KEY environment variable. ' +
          'Currently using HS256 symmetric fallback.',
      );
    }
  }

  // ---- Registration ----

  async register(
    dto: RegisterDto,
    req: Request | null = null,
  ): Promise<{ user: ReturnType<UsersService['sanitize']> & { isPlatformAdmin: boolean } }> {
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
        entitlementsJson: {},
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

    // Capture signup IP/UA/geo as a login_success event so the admin "Last
    // Login" column reflects the user's first known network context.
    this.emitLoginEvent('login_success', user.id, req);

    // Newly-registered owner of a personal org never has admin:* permissions
    // (those are only granted to platform staff via RBAC). Compute anyway so
    // the response shape stays consistent — fail-closed if anything errors.
    const member = await this.prisma.organizationMember.findFirst({
      where: { userId: user.id, organizationId: org.id, status: 'active' },
      select: { id: true },
    });
    const isPlatformAdmin = member
      ? await this.computeIsPlatformAdmin(member.id)
      : false;

    return {
      user: { ...this.usersService.sanitize(user), isPlatformAdmin },
    };
  }

  // ---- Login ----

  async login(
    dto: LoginDto,
    deviceFingerprint: string,
    req: Request | null = null,
  ): Promise<{
    tokens: TokenPair;
    user: ReturnType<UsersService['sanitize']> & { isPlatformAdmin: boolean };
    mfaRequired: boolean;
  }> {
    const ip = this.clientIp(req);

    // Two-layer brute-force gate: throws 429 (with Retry-After) if either the
    // per-account or per-IP layer is locked. Runs BEFORE bcrypt.compare so a
    // locked account/IP never reaches the (expensive) credential check.
    await this.loginThrottle.assertNotLocked(dto.email, ip);

    const user = await this.usersService.findByEmail(dto.email);
    if (!user || !user.passwordHash) {
      // Count unknown-account failures too — Layer 2 (per-IP velocity) exists to
      // catch credential stuffing, which sprays many addresses we don't know.
      // No login_failed event here: there's no user.id to attach. recordFailure
      // hashes the email itself, so bumping the per-account counter for a
      // non-existent address is harmless and removes an enumeration oracle.
      await this.loginThrottle.recordFailure(dto.email, ip);
      throw new UnauthorizedException('Invalid email or password');
    }

    if (user.status !== 'active') {
      await this.loginThrottle.recordFailure(dto.email, ip);
      this.emitLoginEvent('login_failed', user.id, req, {
        failureReason: 'account_inactive',
        deviceFingerprint,
      });
      throw new UnauthorizedException('Account is suspended or deactivated');
    }

    const passwordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordValid) {
      await this.loginThrottle.recordFailure(dto.email, ip);
      this.emitLoginEvent('login_failed', user.id, req, {
        failureReason: 'invalid_password',
        deviceFingerprint,
      });
      throw new UnauthorizedException('Invalid email or password');
    }

    // Check MFA if enabled
    if (user.mfaEnabled && user.mfaSecret) {
      if (!dto.mfaCode) {
        // MFA challenge — no membership resolved yet, so omit the admin flag
        // entirely. The web client only persists user after a non-MFA login
        // anyway, and the next call (with mfaCode) returns the full payload.
        return {
          tokens: { accessToken: '', refreshToken: '' },
          user: { ...this.usersService.sanitize(user), isPlatformAdmin: false },
          mfaRequired: true,
        };
      }
      const mfaValid = this.verifyTotp(user.mfaSecret, dto.mfaCode);
      if (!mfaValid) {
        await this.loginThrottle.recordFailure(dto.email, ip);
        this.emitLoginEvent('login_failed', user.id, req, {
          failureReason: 'invalid_mfa',
          deviceFingerprint,
        });
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

    this.emitLoginEvent('login_success', user.id, req, { deviceFingerprint });

    // Clear the per-account failure counter on a fully successful login. The
    // per-IP velocity counter is deliberately preserved (NIST SP 800-63B).
    await this.loginThrottle.recordSuccess(dto.email, ip);

    const isPlatformAdmin = await this.computeIsPlatformAdmin(membership.id);

    return {
      tokens,
      user: { ...this.usersService.sanitize(user), isPlatformAdmin },
      mfaRequired: false,
    };
  }

  // ---- Google OAuth Login ----

  async loginWithGoogle(
    googleProfile: { googleId: string; email: string; fullName: string },
    deviceFingerprint: string,
    req: Request | null = null,
  ): Promise<{
    tokens: TokenPair;
    user: ReturnType<UsersService['sanitize']> & { isPlatformAdmin: boolean };
    isNewUser: boolean;
  }> {
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
        await this.provisionPersonalWorkspace(user.id, googleProfile.fullName);
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

    this.emitLoginEvent('google_login', user.id, req, { deviceFingerprint });

    const isPlatformAdmin = await this.computeIsPlatformAdmin(membership.id);

    return {
      tokens,
      user: { ...this.usersService.sanitize(user), isPlatformAdmin },
      isNewUser,
    };
  }

  // ---- Apple Sign In (mobile ID-token exchange) ----

  async loginWithApple(
    appleProfile: { appleId: string; email: string | null; fullName?: string },
    deviceFingerprint: string,
    req: Request | null = null,
  ): Promise<{
    tokens: TokenPair;
    user: ReturnType<UsersService['sanitize']> & { isPlatformAdmin: boolean };
    isNewUser: boolean;
  }> {
    // 1. Try to find user by Apple ID (the identity token's stable `sub`)
    let user = await this.usersService.findByAppleId(appleProfile.appleId);
    let isNewUser = false;

    if (!user) {
      // Without an email claim we can neither link nor create an account.
      // Generic 401 — never reveal which part of the credential was rejected.
      if (!appleProfile.email) {
        throw new UnauthorizedException('Invalid Apple credential');
      }

      // 2. Try to find existing user by email (link accounts). Works for
      // private-relay addresses too — relay emails are stable per app.
      user = await this.usersService.findByEmail(appleProfile.email);

      if (user) {
        await this.usersService.linkAppleAccount(user.id, appleProfile.appleId);
        // Mark email as verified since Apple verified it
        if (!user.emailVerified) {
          await this.prisma.user.update({
            where: { id: user.id },
            data: { emailVerified: true, emailVerifyToken: null },
          });
        }
      } else {
        // 3. Create new user from Apple profile. Apple sends the user's name
        // ONLY on first authorization (client forwards it when present) —
        // fall back to the email local-part.
        const fullName =
          appleProfile.fullName?.trim() || appleProfile.email.split('@')[0] || 'User';
        user = await this.usersService.createFromApple({
          email: appleProfile.email,
          fullName,
          appleId: appleProfile.appleId,
        });
        isNewUser = true;
        await this.provisionPersonalWorkspace(user.id, fullName);
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
      true, // provider login is the second-factor equivalent (matches Google)
      deviceFingerprint,
    );

    this.emitLoginEvent('apple_login', user.id, req, { deviceFingerprint });

    const isPlatformAdmin = await this.computeIsPlatformAdmin(membership.id);

    return {
      tokens,
      user: { ...this.usersService.sanitize(user), isPlatformAdmin },
      isNewUser,
    };
  }

  /**
   * Personal org + free subscription + email preferences for a user created
   * via a social provider (register() keeps its own inline copy because it
   * also threads the org through admin-flag computation).
   */
  private async provisionPersonalWorkspace(userId: string, fullName: string): Promise<void> {
    const slug = this.generateSlug(fullName);
    const org = await this.prisma.organization.create({
      data: {
        name: `${fullName}'s Workspace`,
        slug,
        type: 'individual',
        billingOwnerUserId: userId,
      },
    });

    await this.prisma.organizationMember.create({
      data: {
        organizationId: org.id,
        userId,
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
        entitlementsJson: {},
      },
    });

    await this.prisma.emailPreference.create({
      data: {
        userId,
        unsubscribeToken: crypto.randomBytes(32).toString('hex'),
      },
    });
  }

  // ---- Refresh Token ----

  async refreshTokens(
    refreshToken: string,
    deviceFingerprint: string,
    req: Request | null = null,
  ): Promise<TokenPair> {
    const tokenHash = this.hashToken(refreshToken);

    // Atomic claim: a single guarded UPDATE collapses the prior
    // read-then-update sequence (three round-trips with no row lock) into
    // one write that exactly one concurrent caller can win. The WHERE
    // clause filters on isRevoked=false so a second caller sees count=0
    // and falls into the reuse-detection branch below.
    const claim = await this.prisma.refreshToken.updateMany({
      where: { tokenHash, isRevoked: false },
      data: { isRevoked: true },
    });

    if (claim.count === 0) {
      // Either the token never existed, or it was already revoked — the
      // latter is the reuse-detection signal (the legitimate rotator
      // already flipped it, and this is the second concurrent caller or
      // a delayed replay).
      const revokedRow = await this.prisma.refreshToken.findFirst({
        where: { tokenHash, isRevoked: true },
        select: { id: true, familyId: true, userId: true },
      });
      if (revokedRow) {
        this.logger.warn(
          `Refresh token reuse detected for family ${revokedRow.familyId}`,
        );
        await this.prisma.refreshToken.updateMany({
          where: { familyId: revokedRow.familyId },
          data: { isRevoked: true },
        });
        throw new UnauthorizedException(
          'Token reuse detected. All sessions revoked.',
        );
      }
      throw new UnauthorizedException('Invalid refresh token');
    }

    // We won the atomic claim; load the row we just revoked for the rest
    // of the rotation flow. The unique-by-hash invariant holds because
    // tokenHash is a SHA-256 of a 256-bit-random refresh token.
    const storedToken = await this.prisma.refreshToken.findFirst({
      where: { tokenHash },
      include: { user: true },
    });

    if (!storedToken) {
      // Should not happen — we just updated this row. Treat as invalid.
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (storedToken.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    if (storedToken.deviceFingerprint && storedToken.deviceFingerprint !== deviceFingerprint) {
      this.logger.warn(`Device fingerprint mismatch for user ${storedToken.userId}`);
      await this.prisma.refreshToken.updateMany({
        where: { familyId: storedToken.familyId },
        data: { isRevoked: true },
      });
      throw new UnauthorizedException('Device mismatch. All sessions revoked.');
    }

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

    this.emitLoginEvent('token_refresh', storedToken.userId, req, { deviceFingerprint });

    return tokens;
  }

  // ---- Logout ----

  async logout(refreshToken: string, req: Request | null = null): Promise<void> {
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

      this.emitLoginEvent('logout', storedToken.userId, req);
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

  // ---- Change Password (authenticated) ----

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.usersService.findById(userId);

    if (!user.passwordHash) {
      throw new BadRequestException(
        'No password set on this account. Use the password reset flow.',
      );
    }

    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    if (currentPassword === newPassword) {
      throw new BadRequestException(
        'New password must differ from current password',
      );
    }

    await this.checkBreachedPassword(newPassword);

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId, isRevoked: false },
        data: { isRevoked: true },
      }),
    ]);
  }

  /**
   * Best-effort post-change side effects: notification email + login event.
   * Runs after the password change succeeds and the response has been sent,
   * so a queue/DB hiccup here cannot regress the user-facing flow. Errors
   * are logged and swallowed.
   */
  async recordPasswordChangedSideEffects(
    userId: string,
    req: Request | null,
    ip: string,
  ): Promise<void> {
    try {
      const user = await this.usersService.findById(userId);
      await this.notificationsService.sendPasswordChangedEmail(
        user.email,
        user.fullName ?? 'User',
        ip,
        new Date(),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `password_changed notification dropped for user ${userId}: ${message}`,
      );
    }

    try {
      await this.loginEvents.record('password_changed', userId, req);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `password_changed login_event dropped for user ${userId}: ${message}`,
      );
    }
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
    } catch (err) {
      this.logger.warn(
        `verifyTotp threw — TOTP rejected: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  private verifyTotpRaw(plaintextSecret: string, code: string): boolean {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const otplib = require('otplib');
      return (otplib.authenticator.check as (token: string, secret: string) => boolean)(code, plaintextSecret);
    } catch (err) {
      this.logger.warn(
        `verifyTotpRaw threw — TOTP rejected: ${err instanceof Error ? err.message : String(err)}`,
      );
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

  /**
   * Resolve the client IP for brute-force throttling. Mirrors
   * LoginEventService.extractIp: strips the IPv4-mapped IPv6 prefix so the
   * per-IP key matches across transports. Returns 'unknown' when no request
   * context is available (e.g. service-level callers in tests).
   */
  private clientIp(req: Request | null): string {
    const ip = req?.ip;
    if (!ip) return 'unknown';
    return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  }

  /**
   * Resolve platform-admin status from the member's effective permissions
   * (any `admin:*` code) at token-issuance time. JwtAuthGuard has not run
   * yet on login/register/refresh, so the JWT-strategy lookup is not in
   * play — we resolve directly here. Fail-closed on error: the frontend
   * uses this to decide whether to render paywall UI, so a transient RBAC
   * failure should bias toward showing the upsell rather than unlocking
   * features we cannot prove the user is entitled to.
   */
  private async computeIsPlatformAdmin(memberId: string): Promise<boolean> {
    try {
      const perms = await this.permissions.getEffectivePermissions(memberId);
      return perms.some((p) => p.startsWith('admin:'));
    } catch (err) {
      this.logger.warn(
        `Failed to compute isPlatformAdmin for member ${memberId}: ${(err as Error).message}`,
      );
      return false;
    }
  }

  private generateSlug(name: string): string {
    const base = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    const suffix = crypto.randomBytes(4).toString('hex');
    return `${base}-${suffix}`;
  }

  /**
   * Fire-and-forget login event capture. Never awaited from auth flows so
   * geo lookup / DB pressure cannot regress login latency (per Phase 2 spec).
   */
  private emitLoginEvent(
    eventType: LoginEventType,
    userId: string,
    req: Request | null,
    extra?: { failureReason?: string; deviceFingerprint?: string },
  ): void {
    void this.loginEvents.record(eventType, userId, req, extra ?? {}).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`login_event ${eventType} dropped for user ${userId}: ${message}`);
    });
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
