import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEmail, IsInt, IsNotEmpty, IsOptional, IsString, IsUrl, MaxLength, Min, ValidateNested } from 'class-validator';
import { IMAGE_URL_OPTIONS } from '../common/validation';

export class ExchangeItemDto {
  @IsString() @IsNotEmpty() orderItemId: string;
  @IsInt() @Min(1) quantity: number;
}

export class CreateExchangeDto {
  @IsString() @IsNotEmpty() @MaxLength(20) orderNumber: string;
  @IsOptional() @IsEmail() email?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => ExchangeItemDto) items: ExchangeItemDto[];
  @IsString() @IsNotEmpty() @MaxLength(120) reason: string;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(6) @IsUrl(IMAGE_URL_OPTIONS, { each: true }) photoUrls?: string[];
}

export class ExchangeActionDto {
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
}
