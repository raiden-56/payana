import { Inject, Injectable, Module } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { JobLock } from '../../common/redis/redis.module.js';
import { APP_CONFIG, type AppConfig } from '../../config/env.js';
import { AccountService } from './application/account.service.js';
import { AdminAuthService } from './application/admin-auth.service.js';
import { OtpAuthService } from './application/otp-auth.service.js';
import { SMS_SENDER } from './application/ports.js';
import { SessionService } from './application/session.service.js';
import { UsersAdminService } from './application/users-admin.service.js';
import { DevSmsSender, ProviderSmsSender } from './infrastructure/sms.adapters.js';
import { AdminUsersController } from './presentation/admin-users.controller.js';
import { AuthController } from './presentation/auth.controller.js';
import { MeController } from './presentation/me.controller.js';
import { Db } from '../../common/db/db.service.js';

@Injectable()
class IdentityJobs {
  constructor(
    private readonly accounts: AccountService,
    private readonly db: Db,
    private readonly lock: JobLock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async eraseDueAccounts(): Promise<void> {
    if (!this.config.jobsEnabled) return;
    await this.lock.runExclusive('erase-accounts', 600, async () => {
      await this.accounts.eraseDueAccounts();
    });
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purgeExpiredAuthRecords(): Promise<void> {
    if (!this.config.jobsEnabled) return;
    await this.lock.runExclusive('purge-auth', 600, async () => {
      await this.db.exec(`DELETE FROM otp_challenges WHERE created_at < now() - interval '1 day'`);
      await this.db.exec(`DELETE FROM auth_sessions WHERE expires_at < now() - interval '7 days'`);
      await this.db.exec(`DELETE FROM idempotency_keys WHERE created_at < now() - interval '2 days'`);
      await this.db.exec(`DELETE FROM outbox_events WHERE processed_at < now() - interval '14 days'`);
    });
  }
}

/** Identity and access: OTP sign-in, sessions, administrator MFA, the account's own data, staff. */
@Module({
  controllers: [AuthController, MeController, AdminUsersController],
  providers: [
    SessionService,
    AccountService,
    OtpAuthService,
    AdminAuthService,
    UsersAdminService,
    IdentityJobs,
    {
      provide: SMS_SENDER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => (config.sms.driver === 'dev' ? new DevSmsSender() : new ProviderSmsSender()),
    },
  ],
  exports: [AccountService, SessionService, UsersAdminService, SMS_SENDER],
})
export class IdentityModule {}
