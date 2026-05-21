import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { JwtPayload } from '@libertasian/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TrackEvent } from '../analytics';
import { AuditService } from '../audit/audit.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { AuthService } from './auth.service';
import type { GoogleProfile } from './strategies/google.strategy';
import {
  RegisterDto,
  LoginDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  ChangePasswordDto,
  VerifyEmailDto,
  ResendVerificationDto,
  MfaVerifyDto,
  MfaDisableDto,
  AcceptInviteDto,
} from './dto';

/** Cookie name for the httpOnly refresh token */
const REFRESH_COOKIE = 'libertasian-refresh';

/**
 * Auth controller — rate limited to 10 requests per 15 minutes per IP
 * for public auth endpoints (login, register, forgot-password, reset-password)
 * per CLAUDE.md security standards.
 */
@ApiTags('Auth')
@Controller('auth')
@Throttle({ default: { ttl: 900000, limit: 10 } }) // 10 requests per 15 min (auth routes)
export class AuthController {
  private readonly googleEnabled: boolean;
  private readonly appUrl: string;
  private readonly refreshTtl: number;
  private readonly isProduction: boolean;

  constructor(
    private readonly authService: AuthService,
    private readonly auditService: AuditService,
    private readonly configService: ConfigService,
    private readonly organizationsService: OrganizationsService,
  ) {
    this.googleEnabled = !!(
      this.configService.get<string>('GOOGLE_CLIENT_ID') &&
      this.configService.get<string>('GOOGLE_CLIENT_SECRET')
    );
    this.appUrl = this.configService.get<string>('APP_URL', 'http://localhost:3000');
    this.refreshTtl = this.configService.get<number>('JWT_REFRESH_TTL', 604800);
    this.isProduction = this.configService.get<string>('NODE_ENV') === 'production';
  }

  /**
   * Detect mobile clients by an explicit `X-Client: mobile` request header.
   * Mobile clients receive the refresh token in the response body and skip
   * the httpOnly Set-Cookie path, since RN's fetch does not persist cookies.
   * Header is opt-in — no User-Agent sniffing or auto-detection.
   */
  private isMobileClient(req: Request): boolean {
    const headerValue = req.headers['x-client'];
    const value = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    return typeof value === 'string' && value.toLowerCase() === 'mobile';
  }

  /** Set httpOnly cookie with the refresh token */
  private setRefreshCookie(res: Response, refreshToken: string): void {
    res.cookie(REFRESH_COOKIE, refreshToken, {
      httpOnly: true,
      secure: this.isProduction,
      sameSite: 'strict',
      path: '/api/v1/auth',
      maxAge: this.refreshTtl * 1000,
    });
  }

  /** Clear the httpOnly refresh cookie */
  private clearRefreshCookie(res: Response): void {
    res.cookie(REFRESH_COOKIE, '', {
      httpOnly: true,
      secure: this.isProduction,
      sameSite: 'strict',
      path: '/api/v1/auth',
      maxAge: 0,
    });
  }

  @Post('register')
  @ApiOperation({ summary: 'Register a new user account' })
  @TrackEvent('user_signed_up', () => ({
    method: 'email',
  }))
  async register(@Body() dto: RegisterDto, @Req() req: Request, @Ip() ip: string) {
    const result = await this.authService.register(dto, req);
    await this.auditService.log({
      actorUserId: result.user.id,
      actorType: 'user',
      action: 'auth.register',
      entityType: 'user',
      entityId: result.user.id,
      metadata: { ip },
    });
    return { success: true, data: { ...result, verifyEmail: dto.email } };
  }

  // ---- Google OAuth ----

  @Get('google')
  @UseGuards(AuthGuard('google'))
  @ApiOperation({ summary: 'Initiate Google OAuth login flow' })
  googleLogin(): void {
    // Passport redirects to Google — this handler body never executes
  }

  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  @ApiOperation({ summary: 'Google OAuth callback — issues JWT tokens' })
  async googleCallback(
    @Req() req: Request,
    @Res() res: Response,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
  ): Promise<void> {
    const googleProfile = req.user as GoogleProfile;
    const fingerprint = this.buildDeviceFingerprint(userAgent || '', ip);

    const result = await this.authService.loginWithGoogle(googleProfile, fingerprint, req);

    await this.auditService.log({
      actorUserId: result.user.id,
      actorType: 'user',
      action: result.isNewUser ? 'auth.google_register' : 'auth.google_login',
      entityType: 'user',
      entityId: result.user.id,
      metadata: { ip, provider: 'google' },
    });

    // Set refresh token as httpOnly cookie — never exposed to JS
    this.setRefreshCookie(res, result.tokens.refreshToken);

    // Only pass accessToken as query param (short-lived, consumed immediately)
    const params = new URLSearchParams({
      accessToken: result.tokens.accessToken,
    });
    res.redirect(`${this.appUrl}/auth/callback?${params.toString()}`);
  }

  @Post('login')
  @ApiOperation({ summary: 'Login with email and password' })
  @TrackEvent('user_logged_in', () => ({
    method: 'email',
    device_type: 'web',
  }))
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const fingerprint = this.buildDeviceFingerprint(userAgent, ip);
    const result = await this.authService.login(dto, fingerprint, req);
    const isMobile = this.isMobileClient(req);

    if (!result.mfaRequired) {
      // Web clients store the refresh token in an httpOnly cookie.
      // Mobile clients receive it in the response body (no cookie jar).
      if (!isMobile) {
        this.setRefreshCookie(res, result.tokens.refreshToken);
      }

      await this.auditService.log({
        actorUserId: result.user.id,
        actorType: 'user',
        action: 'auth.login',
        entityType: 'user',
        entityId: result.user.id,
        metadata: { ip, userAgent: this.truncateUserAgent(userAgent) },
      });
    }

    const tokens =
      !result.mfaRequired && isMobile
        ? { accessToken: result.tokens.accessToken, refreshToken: result.tokens.refreshToken }
        : { accessToken: result.tokens.accessToken };

    return {
      success: true,
      data: {
        tokens,
        user: result.user,
        mfaRequired: result.mfaRequired,
      },
    };
  }

  @Post('refresh')
  @ApiOperation({ summary: 'Refresh access token (web: httpOnly cookie; mobile: request body)' })
  async refresh(
    @Req() req: Request,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const isMobile = this.isMobileClient(req);
    const bodyRefreshToken =
      isMobile && req.body && typeof req.body === 'object'
        ? ((req.body as Record<string, unknown>)['refreshToken'] as string | undefined)
        : undefined;
    const refreshToken = isMobile
      ? bodyRefreshToken
      : (req.cookies as Record<string, string>)?.[REFRESH_COOKIE];
    if (!refreshToken) {
      throw new UnauthorizedException('No refresh token');
    }

    const fingerprint = this.buildDeviceFingerprint(userAgent, ip);

    try {
      const tokens = await this.authService.refreshTokens(refreshToken, fingerprint, req);

      // Rotate: web sets new refresh token as httpOnly cookie; mobile gets it in body.
      if (!isMobile) {
        this.setRefreshCookie(res, tokens.refreshToken);
        return { success: true, data: { accessToken: tokens.accessToken } };
      }

      return {
        success: true,
        data: { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken },
      };
    } catch (err) {
      if (err instanceof UnauthorizedException) {
        await this.auditService.log({
          actorType: 'system',
          action: 'auth.refresh_rejected',
          entityType: 'refresh_token',
          metadata: {
            ip,
            userAgent: this.truncateUserAgent(userAgent),
            reason: err.message,
          },
        });
      }
      throw err;
    }
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout and revoke refresh token family' })
  async logout(
    @Req() req: Request,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const isMobile = this.isMobileClient(req);
    const bodyRefreshToken =
      isMobile && req.body && typeof req.body === 'object'
        ? ((req.body as Record<string, unknown>)['refreshToken'] as string | undefined)
        : undefined;
    const refreshToken = isMobile
      ? bodyRefreshToken
      : (req.cookies as Record<string, string>)?.[REFRESH_COOKIE];
    if (refreshToken) {
      await this.authService.logout(refreshToken, req);
    }

    // Web: clear the httpOnly refresh cookie. Mobile has no cookie to clear.
    if (!isMobile) {
      this.clearRefreshCookie(res);
    }

    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'user',
      action: 'auth.logout',
      entityType: 'user',
      entityId: user.sub,
      metadata: { ip },
    });
    return { success: true, data: { message: 'Logged out successfully' } };
  }

  @Post('forgot-password')
  @ApiOperation({ summary: 'Request password reset email' })
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Ip() ip: string) {
    const result = await this.authService.forgotPassword(dto.email);
    await this.auditService.log({
      actorType: 'system',
      action: 'auth.forgot_password',
      entityType: 'user',
      metadata: { ip, email: this.redactEmail(dto.email) },
    });
    return { success: true, data: result };
  }

  @Post('reset-password')
  @ApiOperation({ summary: 'Reset password using token from email' })
  async resetPassword(@Body() dto: ResetPasswordDto, @Ip() ip: string) {
    await this.authService.resetPassword(dto.token, dto.newPassword);
    await this.auditService.log({
      actorType: 'system',
      action: 'auth.reset_password',
      entityType: 'user',
      metadata: { ip },
    });
    return { success: true, data: { message: 'Password reset successfully' } };
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Change password (authenticated). Revokes all sessions including current — client must sign in again.',
  })
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Ip() ip: string,
  ) {
    await this.authService.changePassword(user.sub, dto.currentPassword, dto.newPassword);
    this.clearRefreshCookie(res);

    // Best-effort side effects — do not block the response
    void this.authService.recordPasswordChangedSideEffects(user.sub, req, ip);

    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'user',
      action: 'auth.change_password',
      entityType: 'user',
      entityId: user.sub,
      metadata: { ip },
    });

    return {
      success: true,
      data: { message: 'Password changed successfully. Please sign in again.' },
    };
  }

  // ---- Email Verification ----

  @Post('verify-email')
  @ApiOperation({ summary: 'Verify email address using 6-digit code' })
  async verifyEmail(@Body() dto: VerifyEmailDto, @Ip() ip: string) {
    await this.authService.verifyEmail(dto.email, dto.code);
    await this.auditService.log({
      actorType: 'system',
      action: 'auth.verify_email',
      entityType: 'user',
      metadata: { ip, email: this.redactEmail(dto.email) },
    });
    return { success: true, data: { message: 'Email verified successfully' } };
  }

  @Post('resend-verification')
  @ApiOperation({ summary: 'Resend email verification code (max 3 per 15 min per email)' })
  async resendVerification(@Body() dto: ResendVerificationDto, @Ip() ip: string) {
    await this.authService.resendVerificationEmail(dto.email);
    await this.auditService.log({
      actorType: 'system',
      action: 'auth.resend_verification',
      entityType: 'user',
      metadata: { ip, email: this.redactEmail(dto.email) },
    });
    return { success: true, data: { message: 'If the email is registered, a new verification code has been sent.' } };
  }

  // ---- MFA Management ----

  @Post('mfa/enroll')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Start MFA enrollment — returns TOTP secret and QR URI' })
  async enrollMfa(@CurrentUser() user: JwtPayload, @Ip() ip: string) {
    const result = await this.authService.enrollMfa(user.sub);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'user',
      action: 'auth.mfa_enroll_start',
      entityType: 'user',
      entityId: user.sub,
      metadata: { ip },
    });
    return { success: true, data: result };
  }

  @Post('mfa/verify')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Confirm MFA enrollment with TOTP code' })
  async verifyMfa(
    @Body() dto: MfaVerifyDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    await this.authService.confirmMfaEnrollment(user.sub, dto.code);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'user',
      action: 'auth.mfa_enrolled',
      entityType: 'user',
      entityId: user.sub,
      metadata: { ip },
    });
    return { success: true, data: { message: 'MFA enabled successfully' } };
  }

  @Post('mfa/disable')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Disable MFA — requires password confirmation' })
  async disableMfa(
    @Body() dto: MfaDisableDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    await this.authService.disableMfa(user.sub, dto.password);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'user',
      action: 'auth.mfa_disabled',
      entityType: 'user',
      entityId: user.sub,
      metadata: { ip },
    });
    return { success: true, data: { message: 'MFA disabled successfully' } };
  }

  // ---- Session Management ----

  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List active sessions for current user' })
  async listSessions(@CurrentUser() user: JwtPayload) {
    const sessions = await this.authService.listSessions(user.sub);
    return { success: true, data: sessions };
  }

  @Delete('sessions/:familyId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke a specific session by family ID' })
  async revokeSession(
    @Param('familyId', ParseUUIDPipe) familyId: string,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    await this.authService.revokeSession(user.sub, familyId);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'user',
      action: 'auth.session_revoked',
      entityType: 'session',
      entityId: familyId,
      metadata: { ip },
    });
    return { success: true, data: { message: 'Session revoked' } };
  }

  @Delete('sessions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke all sessions (logout everywhere)' })
  async revokeAllSessions(
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    await this.authService.revokeAllSessions(user.sub);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'user',
      action: 'auth.all_sessions_revoked',
      entityType: 'user',
      entityId: user.sub,
      metadata: { ip },
    });
    return { success: true, data: { message: 'All sessions revoked' } };
  }

  // ---- Invite Acceptance ----

  @Post('accept-invite')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Accept a pending organization invite' })
  async acceptInvite(
    @Body() dto: AcceptInviteDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const member = await this.organizationsService.acceptInvite(
      dto.token,
      user.sub,
    );
    await this.auditService.log({
      organizationId: member.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'organization.invite_accepted',
      entityType: 'organization_member',
      entityId: member.id,
      metadata: { ip },
    });
    return { success: true, data: member };
  }

  // ---- Helpers ----

  /** Build device fingerprint from user-agent + IP prefix per CLAUDE.md */
  private buildDeviceFingerprint(userAgent: string, ip: string): string {
    const ipPrefix = ip.includes(':')
      ? ip.split(':').slice(0, 4).join(':') // IPv6: first 4 segments
      : ip.split('.').slice(0, 3).join('.'); // IPv4: first 3 octets
    return `${ipPrefix}|${(userAgent || '').substring(0, 200)}`;
  }

  /** Redact email for audit logs per CLAUDE.md: j***@example.com */
  private redactEmail(email: string): string {
    const [local, domain] = email.split('@');
    if (!local || !domain) return '***';
    return `${local[0]}***@${domain}`;
  }

  private truncateUserAgent(ua: string): string {
    return (ua || '').substring(0, 200);
  }
}
