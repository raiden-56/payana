import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  ApiRoutes,
  Currency,
  Permission,
  RegionStatus,
  VehicleIcon,
  type CategoryPricing,
  type FareEstimate,
  type Money,
  type PlaceSearchQuery,
  type PlaceSuggestion,
  type Region,
  type RegionInput,
  type VehicleCategory,
  type VehicleCategoryInput,
} from '@payana/contracts';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
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
import { LatLngDto } from '../../../common/http/validators.js';
import { CatalogService } from '../application/catalog.service.js';

const SLUG = /^[a-z][a-z0-9-]{1,39}$/;
const CODE = /^[a-z][a-z0-9_]{1,39}$/;

class MoneyDto implements Money {
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  amountMinor!: number;

  @IsIn([Currency.INR])
  currency!: Currency;
}

class CategoryPricingDto implements CategoryPricing {
  @ValidateNested() @Type(() => MoneyDto) baseFare!: MoneyDto;
  @ValidateNested() @Type(() => MoneyDto) perKm!: MoneyDto;
  @ValidateNested() @Type(() => MoneyDto) minPerKm!: MoneyDto;
  @ValidateNested() @Type(() => MoneyDto) maxPerKm!: MoneyDto;
  @ValidateNested() @Type(() => MoneyDto) perHourWaiting!: MoneyDto;
}

class RegionInputDto implements RegionInput {
  @Matches(SLUG, { message: 'Use lower-case letters, digits and hyphens, starting with a letter.' })
  slug!: string;

  @IsString() @Length(2, 60)
  name!: string;

  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(60)
  nameLocal!: string | null;

  @IsString() @Length(2, 60)
  state!: string;

  @ValidateNested() @Type(() => LatLngDto)
  center!: LatLngDto;

  @IsNumber() @Min(1) @Max(100)
  radiusKm!: number;

  @IsEnum(RegionStatus)
  status!: RegionStatus;

  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(160)
  tagline!: string | null;
}

class VehicleCategoryInputDto implements VehicleCategoryInput {
  @Matches(CODE, { message: 'Use lower-case letters, digits and underscores, starting with a letter.' })
  code!: string;

  @IsString() @Length(2, 60)
  name!: string;

  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(240)
  description!: string | null;

  @IsEnum(VehicleIcon)
  icon!: VehicleIcon;

  @IsInt() @Min(1) @Max(60)
  seats!: number;

  @IsInt() @Min(0) @Max(60)
  luggageCapacity!: number;

  @ValidateNested() @Type(() => CategoryPricingDto)
  pricing!: CategoryPricingDto;

  @IsInt() @Min(0) @Max(1000)
  sortOrder!: number;

  @IsBoolean()
  isActive!: boolean;
}

class PlaceSearchDto implements PlaceSearchQuery {
  @IsOptional() @Matches(SLUG)
  regionSlug?: string;

  @IsOptional() @IsString() @MaxLength(60)
  q?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;
}

class FareEstimateQueryDto {
  @Type(() => Number) @IsLatitude() fromLat!: number;
  @Type(() => Number) @IsLongitude() fromLng!: number;
  @Type(() => Number) @IsLatitude() toLat!: number;
  @Type(() => Number) @IsLongitude() toLng!: number;
  @Matches(CODE) categoryCode!: string;
}

@ApiTags('catalog')
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Public()
  @Get(ApiRoutes.catalog.regions)
  @Header('Cache-Control', 'public, max-age=300')
  @ApiContract({ summary: 'Regions that are live or coming soon', response: 'Region', array: true })
  regions(): Promise<Region[]> {
    return this.catalog.listRegions(false);
  }

  @Public()
  @Get(ApiRoutes.catalog.vehicleCategories)
  @Header('Cache-Control', 'public, max-age=300')
  @ApiContract({ summary: 'Active vehicle categories with pricing rules', response: 'VehicleCategory', array: true })
  categories(): Promise<VehicleCategory[]> {
    return this.catalog.listCategories(false);
  }

  @Public()
  @Get(ApiRoutes.catalog.places)
  @Header('Cache-Control', 'public, max-age=300')
  @ApiContract({ summary: 'Curated pickup and drop points', response: 'PlaceSuggestion', array: true })
  places(@Query() q: PlaceSearchDto): Promise<PlaceSuggestion[]> {
    return this.catalog.searchPlaces(q);
  }

  @Public()
  @Get(ApiRoutes.catalog.fareEstimate)
  @ApiContract({ summary: 'Indicative fare range between two points (not a quote)', response: 'FareEstimate' })
  fareEstimate(@Query() q: FareEstimateQueryDto): Promise<FareEstimate> {
    return this.catalog.fareEstimate({ lat: q.fromLat, lng: q.fromLng }, { lat: q.toLat, lng: q.toLng }, q.categoryCode);
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@Controller()
export class AdminCatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get(ApiRoutes.admin.regions)
  @RequirePermission(Permission.CatalogManage)
  @ApiContract({ summary: 'All regions, including hidden', response: 'Region', array: true })
  regions(): Promise<Region[]> {
    return this.catalog.listRegions(true);
  }

  @Post(ApiRoutes.admin.regions)
  @RequirePermission(Permission.CatalogManage)
  @ApiContract({ summary: 'Create a region', body: 'RegionInput', response: 'Region', status: 201 })
  createRegion(@Body() body: RegionInputDto, @CurrentUser() actor: AuthUser): Promise<Region> {
    return this.catalog.createRegion(body, actor);
  }

  @Put(r(ApiRoutes.admin.region(':regionId')))
  @RequirePermission(Permission.CatalogManage)
  @ApiContract({ summary: 'Update a region', body: 'RegionInput', response: 'Region' })
  updateRegion(
    @Param('regionId', ParseUUIDPipe) regionId: string,
    @Body() body: RegionInputDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<Region> {
    return this.catalog.updateRegion(regionId, body, actor);
  }

  @Get(ApiRoutes.admin.vehicleCategories)
  @RequirePermission(Permission.CatalogManage)
  @ApiContract({ summary: 'All vehicle categories, including inactive', response: 'VehicleCategory', array: true })
  categories(): Promise<VehicleCategory[]> {
    return this.catalog.listCategories(true);
  }

  @Post(ApiRoutes.admin.vehicleCategories)
  @RequirePermission(Permission.CatalogManage)
  @ApiContract({ summary: 'Create a vehicle category', body: 'VehicleCategoryInput', response: 'VehicleCategory', status: 201 })
  createCategory(@Body() body: VehicleCategoryInputDto, @CurrentUser() actor: AuthUser): Promise<VehicleCategory> {
    return this.catalog.createCategory(body, actor);
  }

  @Put(r(ApiRoutes.admin.vehicleCategory(':categoryId')))
  @RequirePermission(Permission.CatalogManage)
  @ApiContract({ summary: 'Update a vehicle category', body: 'VehicleCategoryInput', response: 'VehicleCategory' })
  updateCategory(
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Body() body: VehicleCategoryInputDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<VehicleCategory> {
    return this.catalog.updateCategory(categoryId, body, actor);
  }
}
