import { Type } from 'class-transformer';
import { IsLatitude, IsLongitude, IsNumber, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import type { LatLng, Place } from '@payana/contracts';

/** Reusable request building blocks shared by several modules. */
export class LatLngDto implements LatLng {
  @IsNumber()
  @IsLatitude()
  lat!: number;

  @IsNumber()
  @IsLongitude()
  lng!: number;
}

export class PlaceDto implements Place {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  label!: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  address?: string;

  @ValidateNested()
  @Type(() => LatLngDto)
  location!: LatLngDto;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  regionSlug?: string;
}

export const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Query-string booleans arrive as "true" / "false". */
export function toBool({ value }: { value: unknown }): unknown {
  if (value === 'true' || value === '1' || value === true) return true;
  if (value === 'false' || value === '0' || value === false) return false;
  return value;
}
