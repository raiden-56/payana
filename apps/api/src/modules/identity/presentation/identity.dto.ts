import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  ADMIN_PASSWORD_MIN_LENGTH,
  AccountRole,
  AdminRole,
  INDIAN_MOBILE_E164,
  Locale,
  OTP_LENGTH,
  UserStatus,
  type AdminLoginRequest,
  type AdminMfaVerifyRequest,
  type AdminUserQuery,
  type ConsentPreferencesInput,
  type CreateStaffRequest,
  type DeletionRequestInput,
  type EmergencyContact,
  type OtpRequest,
  type OtpVerifyRequest,
  type RefreshRequest,
  type SavedPlaceInput,
  type SignInIntent,
  type SuspendUserRequest,
  type UpdateMeRequest,
  type UpdateStaffRequest,
} from '@payana/contracts';
import { PageQueryDto } from '../../../common/http/pagination.js';
import { LatLngDto } from '../../../common/http/validators.js';

const PHONE_MESSAGE = 'Enter an Indian mobile number in the form +91XXXXXXXXXX.';

export class OtpRequestDto implements OtpRequest {
  @Matches(INDIAN_MOBILE_E164, { message: PHONE_MESSAGE })
  phone!: string;

  @IsOptional()
  @IsIn(['customer', 'driver'])
  intent?: SignInIntent;
}

export class OtpVerifyDto implements OtpVerifyRequest {
  @IsUUID()
  challengeId!: string;

  @Matches(new RegExp(`^\\d{${OTP_LENGTH}}$`), { message: `Enter the ${OTP_LENGTH}-digit code.` })
  code!: string;

  @IsOptional()
  @IsIn(['customer', 'driver'])
  intent?: SignInIntent;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceLabel?: string;
}

export class RefreshDto implements RefreshRequest {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  refreshToken?: string;
}

export class AdminLoginDto implements AdminLoginRequest {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password!: string;
}

export class AdminMfaVerifyDto implements AdminMfaVerifyRequest {
  @IsString()
  @MaxLength(600)
  mfaToken!: string;

  @Matches(/^\d{6}$/, { message: 'Enter the 6-digit code from your authenticator app.' })
  code!: string;
}

export class UpdateMeDto implements UpdateMeRequest {
  @IsOptional()
  @IsString()
  @Length(2, 80)
  displayName?: string;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsEmail()
  @MaxLength(254)
  email?: string | null;

  @IsOptional()
  @IsEnum(Locale)
  locale?: Locale;
}

export class EmergencyContactDto implements EmergencyContact {
  @IsString()
  @Length(2, 80)
  name!: string;

  @Matches(INDIAN_MOBILE_E164, { message: PHONE_MESSAGE })
  phone!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  relationship?: string;
}

export class SavedPlaceDto implements SavedPlaceInput {
  @IsString()
  @Length(1, 60)
  label!: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  address?: string;

  @ValidateNested()
  @Type(() => LatLngDto)
  location!: LatLngDto;

  @IsIn(['home', 'stay', 'work', 'other'])
  kind!: 'home' | 'stay' | 'work' | 'other';
}

export class ConsentDto implements ConsentPreferencesInput {
  @IsBoolean()
  analytics!: boolean;

  @IsBoolean()
  advertising!: boolean;

  @IsBoolean()
  marketingMessages!: boolean;
}

export class DeletionRequestDto implements DeletionRequestInput {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class AdminUserQueryDto extends PageQueryDto implements AdminUserQuery {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;

  @IsOptional()
  @IsEnum(AccountRole)
  role?: AccountRole;

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;
}

export class SuspendUserDto implements SuspendUserRequest {
  @IsString()
  @Length(5, 500)
  reason!: string;
}

export class CreateStaffDto implements CreateStaffRequest {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @Length(2, 80)
  displayName!: string;

  @IsEnum(AdminRole)
  adminRole!: AdminRole;

  @IsString()
  @MinLength(ADMIN_PASSWORD_MIN_LENGTH)
  @MaxLength(200)
  temporaryPassword!: string;
}

export class UpdateStaffDto implements UpdateStaffRequest {
  @IsOptional()
  @IsEnum(AdminRole)
  adminRole?: AdminRole;

  @IsOptional()
  @IsIn([UserStatus.Active, UserStatus.Suspended])
  status?: 'active' | 'suspended';
}
