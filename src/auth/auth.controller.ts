import { Body, Controller, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { CookieOptions, Request, Response } from 'express';
import { AppConfig } from '../config/app-config';
import { AuthService } from './auth.service';
import { REFRESH_COOKIE } from './token.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/auth-types';
import { ForgotPasswordDto, GoogleSignInDto, LoginDto, RegisterDto, ResetPasswordDto, VerifyEmailDto } from './auth.dto';

export function refreshCookieOptions(config: AppConfig, expiresAt?: Date): CookieOptions {
  const prod = config.isProduction;
  return {
    httpOnly: true,
    secure: prod,
    // First-party: the browser reaches the API through the frontend's own origin (Vercel rewrite /api/v1/* →
    // Railway), so the cookie is set on the shop's host with no Domain attribute. 'lax' is enough (every call
    // is same-site) and keeps Safari ITP / Instagram / TikTok webviews from dropping it as third-party; it
    // also blocks cross-site POSTs from carrying it. A stale client still calling Railway cross-site simply
    // gets no cookie (signed out), never an error.
    sameSite: 'lax',
    // Matches the proxied paths the browser calls: /api/v1/auth/refresh and /api/v1/auth/logout.
    path: '/api/v1/auth',
    expires: expiresAt,
  };
}

@Controller('auth')
@Throttle({ default: { limit: 10, ttl: 60_000 } })
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: AppConfig,
  ) {}

  private setCookie(res: Response, refresh: { token: string; expiresAt: Date }) {
    res.cookie(REFRESH_COOKIE, refresh.token, refreshCookieOptions(this.config, refresh.expiresAt));
  }

  @Post('register')
  @HttpCode(201)
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    const { refresh, ...body } = await this.auth.register(dto);
    this.setCookie(res, refresh);
    return body;
  }

  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const { refresh, ...body } = await this.auth.login(dto.email, dto.password);
    this.setCookie(res, refresh);
    return body;
  }

  /** Same response + refresh cookie as /auth/login. */
  @Post('google')
  @HttpCode(200)
  async google(@Body() dto: GoogleSignInDto, @Res({ passthrough: true }) res: Response) {
    const { refresh, ...body } = await this.auth.googleSignIn(dto.credential);
    this.setCookie(res, refresh);
    return body;
  }

  @Post('verify-email')
  @HttpCode(200)
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.auth.verifyEmail(dto.token);
  }

  @Post('resend-verification')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 3, ttl: 15 * 60_000 } })
  resendVerification(@CurrentUser() user: AuthUser) {
    return this.auth.resendVerification(user.id);
  }

  @Post('refresh')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { accessToken, refresh } = await this.auth.refresh(req.cookies?.[REFRESH_COOKIE]);
    this.setCookie(res, refresh);
    return { accessToken };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE]);
    res.clearCookie(REFRESH_COOKIE, refreshCookieOptions(this.config));
    return { ok: true };
  }

  @Post('forgot-password')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async forgot(@Body() dto: ForgotPasswordDto) {
    await this.auth.forgotPassword(dto.email);
    return { ok: true };
  }

  @Post('reset-password')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async reset(@Body() dto: ResetPasswordDto) {
    await this.auth.resetPassword(dto.token, dto.password);
    return { ok: true };
  }
}
