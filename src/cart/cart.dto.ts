import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';

export class UtmDto {
  @IsOptional() @IsString() @MaxLength(100) source?: string;
  @IsOptional() @IsString() @MaxLength(100) medium?: string;
  @IsOptional() @IsString() @MaxLength(150) campaign?: string;
}

export class CreateCartDto {
  @IsOptional() @ValidateNested() @Type(() => UtmDto) utm?: UtmDto;
}

export class AddLineDto {
  @IsString() @IsNotEmpty() variantId: string;
  @IsInt() @Min(1) @Max(10) quantity: number;
}

export class UpdateLineDto {
  @IsOptional() @IsInt() @Min(0) @Max(10) quantity?: number;
  @IsOptional() @IsString() @IsNotEmpty() variantId?: string;
}

export class PromoDto {
  @IsString() @IsNotEmpty() @MaxLength(40) code: string;
}

export class MergeCartDto {
  @IsString() @IsNotEmpty() guestToken: string;
}
