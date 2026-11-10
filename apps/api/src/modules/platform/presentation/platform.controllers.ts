import { Body, Controller, Get, Header, HttpCode, Inject, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiRoutes,
  Permission,
  type AuditLogEntry,
  type Paginated,
  type PlatformSettings,
  type PlatformSettingsUpdate,
  type PublicConfig,
} from '@payana/contracts';
import { Type } from 'class-transformer';
import { IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import type { Redis } from 'ioredis';
import { AuditService } from '../../../common/audit/audit.service.js';
import { CurrentUser, Public, RequirePermission, type AuthUser } from '../../../common/auth/auth.types.js';
import { Db } from '../../../common/db/db.service.js';
import { AppError } from '../../../common/errors/app-error.js';
import { PageQueryDto } from '../../../common/http/pagination.js';
import { ApiContract } from '../../../common/http/api-contract.js';
import { REDIS } from '../../../common/redis/redis.module.js';
import { ErrorCode } from '@payana/contracts';
import { SettingsService } from '../application/settings.service.js';

class AuditLogQueryDto extends PageQueryDto {
  @IsOptional() @IsString() @MaxLength(80)
  action?: string;

  @IsOptional() @IsUUID()
  actorId?: string;

  @IsOptional() @IsString() @MaxLength(60)
  targetType?: string;

  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;

  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @Type(() => String)
  to?: string;
}

@ApiTags('platform')
@Controller()
export class HealthController {
  constructor(
    private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Public()
  @Get(ApiRoutes.health.live)
  @ApiOperation({ summary: 'Liveness: the process is up' })
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Public()
  @Get(ApiRoutes.health.ready)
  @ApiOperation({ summary: 'Readiness: database and Redis are reachable' })
  async ready(): Promise<{ status: 'ok'; checks: Record<string, 'up'> }> {
    const checks: Record<string, 'up' | 'down'> = { database: 'down', redis: 'down' };
    try {
      await this.db.query('SELECT 1');
      checks.database = 'up';
    } catch {
      /* reported below */
    }
    try {
      if ((await this.redis.ping()) === 'PONG') checks.redis = 'up';
    } catch {
      /* reported below */
    }
    if (Object.values(checks).some((c) => c === 'down')) {
      const down = Object.entries(checks)
        .filter(([, v]) => v === 'down')
        .map(([k]) => k)
        .join(', ');
      throw new AppError(503, ErrorCode.UpstreamUnavailable, 'Not ready', `Unavailable: ${down}.`);
    }
    return { status: 'ok', checks: checks as Record<string, 'up'> };
  }
}

@ApiTags('platform')
@Controller()
export class PublicConfigController {
  constructor(private readonly settings: SettingsService) {}

  @Public()
  @Get(ApiRoutes.public.config)
  @Header('Cache-Control', 'public, max-age=60')
  @ApiContract({ summary: 'Configuration every client loads at start-up', response: 'PublicConfig' })
  config(): Promise<PublicConfig> {
    return this.settings.getPublicConfig();
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@Controller()
export class AdminSettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  @Get(ApiRoutes.admin.settings)
  @RequirePermission(Permission.SettingsRead)
  @ApiContract({ summary: 'Read platform settings (analytics, ads, feature flags, fees)', response: 'PlatformSettings' })
  get(): Promise<PlatformSettings> {
    return this.settings.get();
  }

  @Put(ApiRoutes.admin.settings)
  @HttpCode(200)
  @RequirePermission(Permission.SettingsManage)
  @ApiContract({
    summary: 'Update one or more settings sections',
    body: 'PlatformSettingsUpdate',
    response: 'PlatformSettings',
  })
  update(@Body() body: Record<string, unknown>, @CurrentUser() user: AuthUser): Promise<PlatformSettings> {
    return this.settings.update(body as PlatformSettingsUpdate, user);
  }

  @Get(ApiRoutes.admin.auditLogs)
  @RequirePermission(Permission.AuditRead)
  @ApiContract({ summary: 'Search the audit trail', response: 'AuditLogEntry', paginated: true })
  auditLogs(@Query() q: AuditLogQueryDto): Promise<Paginated<AuditLogEntry>> {
    return this.audit.list(q);
  }
}
