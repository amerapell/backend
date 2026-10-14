import { Type } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { ZONE_CODES } from '../common/contract';
import type { ProviderCode, ZoneCode } from '../common/contract';

export class AddressDto {
  @IsOptional() @IsString() id?: string;
  @IsString() @IsNotEmpty() @MaxLength(120) fullName: string;
  @IsString() @IsNotEmpty() @MaxLength(30) phone: string;
  @IsString() @IsNotEmpty() @MaxLength(60) state: string;
  @IsString() @IsNotEmpty() @MaxLength(80) lga: string;
  @IsString() @IsNotEmpty() @MaxLength(120) area: string;
  @IsString() @IsNotEmpty() @MaxLength(250) street: string;
  @IsString() @MaxLength(200) landmark: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string | null;
}

export class QuoteDto {
  @IsIn(ZONE_CODES) zoneCode: ZoneCode;
  @IsBoolean() useCredit: boolean;
}

export class CheckoutDto {
  @IsEmail() @MaxLength(254) email: string;
  @IsString() @IsNotEmpty() @MaxLength(30) phone: string;
  @IsIn(ZONE_CODES) zoneCode: ZoneCode;
  @IsOptional() @ValidateNested() @Type(() => AddressDto) address: AddressDto | null;
  @IsIn(['PAYSTACK', 'BACHS']) provider: ProviderCode;
  @IsBoolean() useCredit: boolean;
  @IsBoolean() marketingConsent: boolean;
  @IsOptional() @IsBoolean() saveAddress?: boolean;
}
