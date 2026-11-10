import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  API_PREFIX,
  ApiRoutes,
  CLIENT_PLATFORM_HEADER,
  type AdminLoginResponse,
  type AuthSession,
  type OtpChallenge,
  type SessionInfo,
} from '@payana/contracts';
import type { Request, Response } from 'express';
import { CurrentUser, Public, type AuthUser } from '../../../common/auth/auth.types.js';
import { ApiContract } from '../../../common/http/api-contract.js';
import { r } from '../../../common/http/route.js';
import { APP_CONFIG, type AppConfig } from '../../../config/env.js';
import { AccountService } from '../application/account.service.js';
import { AdminAuthService } from '../application/admin-auth.service.js';
import { OtpAuthService } from '../application/otp-auth.service.js';
import { SessionService, type IssuedTokens } from '../application/session.service.js';
import { AdminLoginDto, AdminMfaVerifyDto, OtpRequestDto, OtpVerifyDto, RefreshDto } from './identity.dto.js';

export const REFRESH_COOKIE = 'payana_rt';
const REFRESH_COOKIE_PATH = `${API_PREFIX}/auth`;

@ApiTags('auth')
@Controller()
export class AuthController {
  constructor(
    private readonly otp: OtpAuthService,
    private readonly adminAuth: AdminAuthService,
    private readonly sessions: SessionService,
    private readonly accounts: AccountService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Post(ApiRoutes.auth.otpRequest)
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiContract({ summary: 'Send a one-time code to a phone number', body: 'OtpRequest', response: 'OtpChallenge' })
  requestOtp(@Body() body: OtpRequestDto): Promise<OtpChallenge> {
    return this.otp.request(body.phone, body.intent ?? 'customer');
  }

  @Public()
  @Post(ApiRoutes.auth.otpVerify)
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiContract({ summary: 'Exchange a one-time code for a session', body: 'OtpVerifyRequest', response: 'AuthSession' })
  async verifyOtp(
    @Body() body: OtpVerifyDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSession> {
    const result = await this.otp.verify(body);
    return this.respond(result.tokens, req, res);
  }

  @Public()
  @Post(ApiRoutes.auth.refresh)
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiContract({ summary: 'Rotate the refresh token and get a new access token', body: 'RefreshRequest', response: 'AuthSession' })
  async refresh(
    @Body() body: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSession> {
    const native = this.isNative(req);
    // Browsers must use the cookie: accepting a body token from them would defeat HttpOnly.
    const presented = native ? body.refreshToken : (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    try {
      const tokens = await this.sessions.refresh(presented);
      return await this.respond(tokens, req, res);
    } catch (err) {
      if (!native) this.clearCookie(res);
      throw err;
    }
  }

  @Post(ApiRoutes.auth.logout)
  @HttpCode(204)
  @ApiBearerAuth()
  @ApiContract({ summary: 'Sign out of the current session' })
  async logout(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.sessions.revoke(user.sessionId, 'logout');
    this.clearCookie(res);
  }

  @Get(ApiRoutes.auth.sessions)
  @ApiBearerAuth()
  @ApiContract({ summary: 'List the signed-in sessions of this account', response: 'SessionInfo', array: true })
  listSessions(@CurrentUser() user: AuthUser): Promise<SessionInfo[]> {
    return this.sessions.list(user.id, user.sessionId);
  }

  @Delete(r(ApiRoutes.auth.session(':sessionId')))
  @HttpCode(204)
  @ApiBearerAuth()
  @ApiContract({ summary: 'Sign out one of this account’s sessions' })
  async revokeSession(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.sessions.revokeOwned(user.id, sessionId);
    if (sessionId === user.sessionId) this.clearCookie(res);
  }

  @Public()
  @Post(ApiRoutes.auth.adminLogin)
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiContract({ summary: 'Administrator sign-in, step 1: email and password', body: 'AdminLoginRequest', response: 'AdminLoginResponse' })
  async adminLogin(
    @Body() body: AdminLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AdminLoginResponse> {
    const outcome = await this.adminAuth.login(body.email, body.password);
    if (outcome.status === 'authenticated') {
      return { status: 'authenticated', session: await this.respond(outcome.tokens, req, res) };
    }
    return outcome;
  }

  @Public()
  @Post(ApiRoutes.auth.adminMfaVerify)
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiContract({ summary: 'Administrator sign-in, step 2: authenticator code', body: 'AdminMfaVerifyRequest', response: 'AuthSession' })
  async adminMfaVerify(
    @Body() body: AdminMfaVerifyDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSession> {
    const tokens = await this.adminAuth.verifyMfa(body.mfaToken, body.code);
    return this.respond(tokens, req, res);
  }

  private isNative(req: Request): boolean {
    return req.get(CLIENT_PLATFORM_HEADER)?.toLowerCase() === 'native';
  }

  private async respond(tokens: IssuedTokens, req: Request, res: Response): Promise<AuthSession> {
    const native = this.isNative(req);
    if (!native) {
      res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
        httpOnly: true,
        secure: this.config.auth.cookieSecure,
        sameSite: 'strict',
        path: REFRESH_COOKIE_PATH,
        expires: tokens.refreshTokenExpiresAt,
      });
    }
    res.setHeader('Cache-Control', 'no-store');
    return {
      accessToken: tokens.accessToken,
      accessTokenExpiresAt: tokens.accessTokenExpiresAt.toISOString(),
      ...(native ? { refreshToken: tokens.refreshToken } : {}),
      me: await this.accounts.getMe(tokens.userId),
    };
  }

  private clearCookie(res: Response): void {
    res.clearCookie(REFRESH_COOKIE, {
      httpOnly: true,
      secure: this.config.auth.cookieSecure,
      sameSite: 'strict',
      path: REFRESH_COOKIE_PATH,
    });
  }
}
