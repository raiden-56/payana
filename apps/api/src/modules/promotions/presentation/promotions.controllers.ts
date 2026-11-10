import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  AdPlacement,
  ApiRoutes,
  Currency,
  PackageArtwork,
  Permission,
  type AdCampaign,
  type AdCampaignInput,
  type AdCreative,
  type Money,
  type PackageStop,
  type TourPackage,
  type TourPackageInput,
} from '@payana/contracts';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { CurrentUser, Public, RequirePermission, type AuthUser } from '../../../common/auth/auth.types.js';
import { ApiContract } from '../../../common/http/api-contract.js';
import { r } from '../../../common/http/route.js';
import { DATE_ONLY } from '../../../common/http/validators.js';
import { PromotionsService } from '../application/promotions.service.js';

const SLUG = /^[a-z][a-z0-9-]{1,59}$/;
const REGION = /^[a-z][a-z0-9-]{1,39}$/;

class MoneyDto implements Money {
  @IsInt() @Min(0) @Max(100_000_000)
  amountMinor!: number;

  @IsIn([Currency.INR])
  currency!: Currency;
}

class PackageStopDto implements PackageStop {
  @IsString() @Length(2, 80)
  name!: string;

  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(240)
  description!: string | null;

  @IsInt() @Min(5) @Max(600)
  durationMinutes!: number;
}

class PackagePriceDto {
  @Matches(/^[a-z][a-z0-9_]{1,39}$/)
  categoryCode!: string;

  @IsOptional() @IsString() @MaxLength(60)
  categoryName!: string;

  @ValidateNested() @Type(() => MoneyDto)
  price!: MoneyDto;
}

class TourPackageInputDto implements TourPackageInput {
  @Matches(SLUG, { message: 'Use lower-case letters, digits and hyphens.' })
  slug!: string;

  @IsString() @Length(3, 80)
  title!: string;

  @IsString() @Length(10, 400)
  summary!: string;

  @Matches(REGION)
  regionSlug!: string;

  @IsEnum(PackageArtwork)
  artwork!: PackageArtwork;

  @IsNumber() @Min(0.5) @Max(72)
  durationHours!: number;

  @IsNumber() @Min(1) @Max(2000)
  distanceKm!: number;

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(12) @ValidateNested({ each: true }) @Type(() => PackageStopDto)
  stops!: PackageStopDto[];

  @IsArray() @ArrayMaxSize(8) @IsString({ each: true }) @MaxLength(100, { each: true })
  highlights!: string[];

  @IsArray() @ArrayMaxSize(8) @ValidateNested({ each: true }) @Type(() => PackagePriceDto)
  priceFrom!: PackagePriceDto[];

  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(120)
  bestTime!: string | null;

  @IsBoolean()
  isActive!: boolean;

  @IsInt() @Min(0) @Max(1000)
  sortOrder!: number;
}

class AdCampaignInputDto implements AdCampaignInput {
  @IsString() @Length(2, 80)
  advertiserName!: string;

  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(120)
  advertiserContact!: string | null;

  @IsString() @Length(3, 70)
  title!: string;

  @IsString() @Length(3, 200)
  body!: string;

  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(500)
  imageUrl!: string | null;

  @IsString() @Length(2, 30)
  ctaLabel!: string;

  @IsString() @MaxLength(500)
  ctaUrl!: string;

  @IsArray() @ArrayMinSize(1) @IsEnum(AdPlacement, { each: true })
  placements!: AdPlacement[];

  @IsArray() @ArrayMaxSize(20) @Matches(REGION, { each: true })
  regionSlugs!: string[];

  @Matches(DATE_ONLY, { message: 'Use YYYY-MM-DD.' })
  startsOn!: string;

  @Matches(DATE_ONLY, { message: 'Use YYYY-MM-DD.' })
  endsOn!: string;

  @IsIn(['draft', 'scheduled', 'paused'])
  status!: 'draft' | 'scheduled' | 'paused';

  @IsInt() @Min(1) @Max(10)
  weight!: number;
}

class PackageQueryDto {
  @IsOptional() @Matches(REGION)
  regionSlug?: string;
}

class AdQueryDto {
  @IsEnum(AdPlacement)
  placement!: AdPlacement;

  @IsOptional() @Matches(REGION)
  regionSlug?: string;
}

@ApiTags('packages')
@Controller()
export class PackagesController {
  constructor(private readonly promotions: PromotionsService) {}

  @Public()
  @Get(ApiRoutes.packages.root)
  @Header('Cache-Control', 'public, max-age=120')
  @ApiContract({ summary: 'Sightseeing packages', response: 'TourPackage', array: true })
  list(@Query() q: PackageQueryDto): Promise<TourPackage[]> {
    return this.promotions.listPackages(q.regionSlug, false);
  }

  @Public()
  @Get(r(ApiRoutes.packages.one(':slug')))
  @ApiContract({ summary: 'One sightseeing package', response: 'TourPackage' })
  one(@Param('slug') slug: string): Promise<TourPackage> {
    return this.promotions.getPackage(slug);
  }
}

@ApiTags('ads')
@Controller()
export class AdsController {
  constructor(private readonly promotions: PromotionsService) {}

  @Public()
  @Get(ApiRoutes.ads.root)
  @ApiContract({ summary: 'Local-business advertisements for a placement', response: 'AdCreative', array: true })
  serve(@Query() q: AdQueryDto): Promise<AdCreative[]> {
    return this.promotions.serveAds(q.placement, q.regionSlug);
  }

  @Public()
  @Post(r(ApiRoutes.ads.impression(':campaignId')))
  @HttpCode(204)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiContract({ summary: 'Record that an advertisement was shown' })
  impression(@Param('campaignId', ParseUUIDPipe) campaignId: string): Promise<void> {
    return this.promotions.recordImpression(campaignId);
  }

  @Public()
  @Post(r(ApiRoutes.ads.click(':campaignId')))
  @HttpCode(204)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiContract({ summary: 'Record that an advertisement was clicked' })
  click(@Param('campaignId', ParseUUIDPipe) campaignId: string): Promise<void> {
    return this.promotions.recordClick(campaignId);
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@Controller()
export class AdminPromotionsController {
  constructor(private readonly promotions: PromotionsService) {}

  @Get(ApiRoutes.admin.packages)
  @RequirePermission(Permission.PackagesManage)
  @ApiContract({ summary: 'All packages, including inactive', response: 'TourPackage', array: true })
  packages(): Promise<TourPackage[]> {
    return this.promotions.listPackages(undefined, true);
  }

  @Post(ApiRoutes.admin.packages)
  @RequirePermission(Permission.PackagesManage)
  @ApiContract({ summary: 'Create a package', body: 'TourPackageInput', response: 'TourPackage', status: 201 })
  createPackage(@Body() body: TourPackageInputDto, @CurrentUser() actor: AuthUser): Promise<TourPackage> {
    return this.promotions.createPackage(body, actor);
  }

  @Put(r(ApiRoutes.admin.package(':packageId')))
  @RequirePermission(Permission.PackagesManage)
  @ApiContract({ summary: 'Update a package', body: 'TourPackageInput', response: 'TourPackage' })
  updatePackage(
    @Param('packageId', ParseUUIDPipe) packageId: string,
    @Body() body: TourPackageInputDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<TourPackage> {
    return this.promotions.updatePackage(packageId, body, actor);
  }

  @Get(ApiRoutes.admin.adCampaigns)
  @RequirePermission(Permission.AdsManage)
  @ApiContract({ summary: 'Advertisement campaigns with their statistics', response: 'AdCampaign', array: true })
  campaigns(): Promise<AdCampaign[]> {
    return this.promotions.listCampaigns();
  }

  @Post(ApiRoutes.admin.adCampaigns)
  @RequirePermission(Permission.AdsManage)
  @ApiContract({ summary: 'Create a campaign', body: 'AdCampaignInput', response: 'AdCampaign', status: 201 })
  createCampaign(@Body() body: AdCampaignInputDto, @CurrentUser() actor: AuthUser): Promise<AdCampaign> {
    return this.promotions.createCampaign(body, actor);
  }

  @Put(r(ApiRoutes.admin.adCampaign(':campaignId')))
  @RequirePermission(Permission.AdsManage)
  @ApiContract({ summary: 'Update a campaign', body: 'AdCampaignInput', response: 'AdCampaign' })
  updateCampaign(
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Body() body: AdCampaignInputDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<AdCampaign> {
    return this.promotions.updateCampaign(campaignId, body, actor);
  }
}
