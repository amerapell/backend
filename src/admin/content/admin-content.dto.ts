import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type { DiscountType } from '../../common/contract';

export class DiscountDto {
  @IsString() @Matches(/^[A-Za-z0-9_-]{3,40}$/, { message: 'code must be 3–40 letters, digits, - or _' }) code: string;
  @IsIn(['PERCENT', 'FIXED', 'FREE_DELIVERY']) type: DiscountType;
  /** PERCENT: 1–100. FIXED: kobo. FREE_DELIVERY: ignored. */
  @IsInt() @Min(0) value: number;
  @IsOptional() @IsString() startsAt?: string | null;
  @IsOptional() @IsString() endsAt?: string | null;
  @IsOptional() @IsInt() @Min(1) maxUses?: number | null;
  @IsOptional() @IsInt() @Min(0) minSubtotalKobo?: number | null;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class UpdateDiscountDto {
  @IsOptional() @IsString() @Matches(/^[A-Za-z0-9_-]{3,40}$/) code?: string;
  @IsOptional() @IsIn(['PERCENT', 'FIXED', 'FREE_DELIVERY']) type?: DiscountType;
  @IsOptional() @IsInt() @Min(0) value?: number;
  @IsOptional() @IsString() startsAt?: string | null;
  @IsOptional() @IsString() endsAt?: string | null;
  @IsOptional() @IsInt() @Min(1) maxUses?: number | null;
  @IsOptional() @IsInt() @Min(0) minSubtotalKobo?: number | null;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class UpdateZoneDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(80) name?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) etaText?: string;
  @IsOptional() @IsInt() @Min(0) feeKobo?: number;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsInt() sortOrder?: number;
}

export class DropDto {
  @IsString() @IsNotEmpty() @MaxLength(120) title: string;
  @IsString() @IsNotEmpty() @MaxLength(120) collectionSlug: string;
  @IsOptional() @IsString() goLiveAt?: string | null;
  @IsOptional() @IsInt() @Min(0) firstRunTotal?: number;
  @IsOptional() @IsInt() firstRunLeft?: number;
}

export class ServiceImagesDto {
  @IsOptional() @IsString() @MaxLength(2000) stylist?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) store?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) exchange?: string | null;
}

export class WelcomePopupDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsString() @MaxLength(80) title?: string;
  @IsOptional() @IsString() @MaxLength(300) text?: string;
  @IsOptional() @IsString() @MaxLength(2000) imageUrl?: string | null;
}

export class UpdateSettingsDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(80) storeName?: string;
  @IsOptional() @IsString() @MaxLength(300) pickupAddress?: string;
  @IsOptional() @IsString() @MaxLength(200) openingHours?: string;
  @IsOptional() @IsString() @MaxLength(30) whatsappNumber?: string;
  @IsOptional() @IsUrl({ require_protocol: true }) instagramUrl?: string;
  @IsOptional() @IsUrl({ require_protocol: true }) tiktokUrl?: string;
  @IsOptional() @IsEmail() contactEmail?: string;
  @IsOptional() @IsString() @MaxLength(30) contactPhone?: string;
  @IsOptional() @IsBoolean() paystackEnabled?: boolean;
  @IsOptional() @IsBoolean() bachsEnabled?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(365) exchangeWindowDays?: number;
  @IsOptional() @IsInt() @Min(1) @Max(3650) creditExpiryDays?: number | null;
  @IsOptional() @IsInt() @Min(0) freeDeliveryThresholdKobo?: number | null;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(80, { each: true }) tickerText?: string[];
  @IsOptional() @ValidateNested() @Type(() => ServiceImagesDto) serviceImages?: ServiceImagesDto;
  @IsOptional() @ValidateNested() @Type(() => WelcomePopupDto) welcomePopup?: WelcomePopupDto;
  @IsOptional() @ValidateNested() @Type(() => DropDto) drop?: DropDto | null;
}

export class FaqDto {
  @IsString() @IsNotEmpty() @MaxLength(40) group: string;
  @IsString() @IsNotEmpty() @MaxLength(300) question: string;
  @IsString() @IsNotEmpty() @MaxLength(5000) answer: string;
  @IsOptional() @IsInt() sortOrder?: number;
}

export class UpdateFaqDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(40) group?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(300) question?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(5000) answer?: string;
  @IsOptional() @IsInt() sortOrder?: number;
}

export class UpdatePageDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) title?: string;
  @IsOptional() @IsString() @MaxLength(100000) bodyMarkdown?: string;
}
