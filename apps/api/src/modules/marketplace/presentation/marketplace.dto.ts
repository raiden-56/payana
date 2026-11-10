import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  AvailabilityStatus,
  DocumentRejectionReason,
  DocumentType,
  DriverSort,
  INDIAN_MOBILE_E164,
  ListingStatus,
  MAX_SEARCH_RADIUS_KM,
  PartnerType,
  VerificationStatus,
  type CreateAuthorizationRequest,
  type DecideVerificationRequest,
  type DriverSearchQuery,
  type LocationPing,
  type ModerateListingRequest,
  type OperatingHours,
  type ReviewDocumentRequest,
  type SubmitDocumentRequest,
  type UpdateAvailabilityRequest,
  type UpdateRatesRequest,
  type UpsertDriverProfileRequest,
  type UpsertVehicleRequest,
  type VerificationQueueQuery,
} from '@payana/contracts';
import { PageQueryDto } from '../../../common/http/pagination.js';
import { DATE_ONLY, LatLngDto, toBool } from '../../../common/http/validators.js';

const SLUG = /^[a-z][a-z0-9-]{1,39}$/;
const CODE = /^[a-z][a-z0-9_]{1,39}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const FILE_KEY = /^[a-z_]+\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$/;

class OperatingHoursDto implements OperatingHours {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(7) @ArrayUnique() @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true })
  days!: number[];

  @Matches(TIME, { message: 'Use 24-hour HH:mm.' })
  from!: string;

  @Matches(TIME, { message: 'Use 24-hour HH:mm.' })
  to!: string;
}

export class UpsertDriverProfileDto implements UpsertDriverProfileRequest {
  @IsEnum(PartnerType)
  partnerType!: PartnerType;

  @IsString() @Length(2, 60)
  displayName!: string;

  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(600)
  bio?: string | null;

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(6) @IsString({ each: true }) @Length(2, 30, { each: true })
  languages!: string[];

  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsInt() @Min(0) @Max(60)
  yearsExperience?: number | null;

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @Matches(SLUG, { each: true })
  serviceAreas!: string[];

  @IsOptional() @ValidateIf((_o, v) => v !== null) @ValidateNested() @Type(() => OperatingHoursDto)
  operatingHours?: OperatingHoursDto | null;

  @IsOptional() @ValidateIf((_o, v) => v !== null) @Matches(FILE_KEY)
  photoKey?: string | null;
}

export class UpsertVehicleDto implements UpsertVehicleRequest {
  @Matches(CODE)
  categoryCode!: string;

  @IsString() @Length(2, 40)
  make!: string;

  @IsString() @Length(1, 40)
  model!: string;

  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsInt() @Min(1990) @Max(2100)
  year?: number | null;

  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(30)
  color?: string | null;

  @IsString() @Length(6, 16)
  registrationNumber!: string;

  @IsInt() @Min(1) @Max(60)
  seats!: number;

  @IsInt() @Min(0) @Max(60)
  luggageCapacity!: number;

  @IsBoolean()
  hasAc!: boolean;

  @IsOptional() @IsArray() @ArrayMaxSize(6) @ArrayUnique() @Matches(FILE_KEY, { each: true })
  photoKeys?: string[];
}

export class UpdateRatesDto implements UpdateRatesRequest {
  @IsUUID()
  vehicleId!: string;

  @IsInt() @Min(0) @Max(10_000_000)
  baseFareMinor!: number;

  @IsInt() @Min(1) @Max(1_000_000)
  perKmMinor!: number;

  @IsInt() @Min(0) @Max(10_000_000)
  perHourWaitingMinor!: number;

  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsInt() @Min(1) @Max(100_000_000)
  fullDayMinor?: number | null;
}

export class SubmitDocumentDto implements SubmitDocumentRequest {
  @IsEnum(DocumentType)
  type!: DocumentType;

  @IsOptional() @IsUUID()
  vehicleId?: string;

  @IsOptional() @IsString() @Length(4, 40) @Matches(/^[A-Za-z0-9\s/-]+$/, { message: 'Use letters, digits, spaces, "/" or "-".' })
  documentNumber?: string;

  @IsOptional() @Matches(DATE_ONLY, { message: 'Use YYYY-MM-DD.' })
  expiresOn?: string;

  @Matches(FILE_KEY, { message: 'Not a valid file reference.' })
  fileKey!: string;
}

export class UpdateAvailabilityDto implements UpdateAvailabilityRequest {
  @IsEnum(AvailabilityStatus)
  status!: AvailabilityStatus;

  @IsOptional() @IsUUID()
  vehicleId?: string;
}

export class LocationPingDto implements LocationPing {
  @ValidateNested() @Type(() => LatLngDto)
  location!: LatLngDto;

  @IsOptional() @IsNumber() @Min(0) @Max(100_000)
  accuracyMeters?: number;

  @IsISO8601({ strict: true })
  recordedAt!: string;
}

export class CreateAuthorizationDto implements CreateAuthorizationRequest {
  @IsUUID()
  vehicleId!: string;

  @Matches(INDIAN_MOBILE_E164, { message: 'Enter an Indian mobile number in the form +91XXXXXXXXXX.' })
  driverPhone!: string;

  @IsOptional() @Matches(DATE_ONLY, { message: 'Use YYYY-MM-DD.' })
  validUntil?: string;
}

export class DriverSearchQueryDto extends PageQueryDto implements DriverSearchQuery {
  @IsOptional() @Type(() => Number) @IsLatitude()
  lat?: number;

  @IsOptional() @Type(() => Number) @IsLongitude()
  lng?: number;

  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) @Max(MAX_SEARCH_RADIUS_KM)
  radiusKm?: number;

  @IsOptional() @Matches(SLUG)
  regionSlug?: string;

  @IsOptional() @Matches(CODE)
  categoryCode?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(60)
  minSeats?: number;

  @IsOptional() @Transform(toBool) @IsBoolean()
  verifiedOnly?: boolean;

  @IsOptional() @Transform(toBool) @IsBoolean()
  availableNow?: boolean;

  @IsOptional() @IsEnum(DriverSort)
  sort?: DriverSort;
}

export class DriverProfileQueryDto {
  @IsOptional() @Type(() => Number) @IsLatitude()
  lat?: number;

  @IsOptional() @Type(() => Number) @IsLongitude()
  lng?: number;
}

export class VerificationQueueQueryDto extends PageQueryDto implements VerificationQueueQuery {
  @IsOptional() @IsEnum(VerificationStatus)
  status?: VerificationStatus;

  @IsOptional() @Matches(SLUG)
  regionSlug?: string;
}

export class ReviewDocumentDto implements ReviewDocumentRequest {
  @IsIn(['approve', 'reject'])
  decision!: 'approve' | 'reject';

  @IsOptional() @IsEnum(DocumentRejectionReason)
  rejectionReason?: DocumentRejectionReason;

  @IsOptional() @IsString() @MaxLength(500)
  note?: string;
}

export class DecideVerificationDto implements DecideVerificationRequest {
  @IsIn(['approve', 'request_changes', 'reject', 'suspend', 'reinstate'])
  decision!: 'approve' | 'request_changes' | 'reject' | 'suspend' | 'reinstate';

  @IsOptional() @IsString() @MaxLength(1000)
  note?: string;
}

export class ModerateListingDto implements ModerateListingRequest {
  @IsEnum(ListingStatus)
  listingStatus!: ListingStatus;

  @IsOptional() @IsString() @MaxLength(500)
  reason?: string;
}
