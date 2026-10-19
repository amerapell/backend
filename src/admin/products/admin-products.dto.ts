import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsHexColor,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type { ProductStatus, SizeGuide } from '../../common/contract';
import { IMAGE_URL_OPTIONS } from '../../common/validation';

export class ColourDto {
  @IsString() @IsNotEmpty() @MaxLength(40) name: string;
  @IsHexColor() hex: string;
}

export class ImageDto {
  @IsUrl(IMAGE_URL_OPTIONS) url: string;
  @IsString() @MaxLength(200) alt: string;
  @IsOptional() @IsString() @MaxLength(40) colour?: string | null;
  /** % of the frame the photo fills: 100 = edge to edge, down to 50 for a small packshot. */
  @IsOptional() @IsInt() @Min(50) @Max(100) scale?: number;
}

export class CreateProductDto {
  @IsString() @IsNotEmpty() @MaxLength(120) name: string;
  @IsOptional() @IsString() @MaxLength(80) slug?: string;
  @IsString() @IsNotEmpty() @MaxLength(20) number: string;
  @IsString() @MaxLength(5000) description: string;
  @IsOptional() @IsString() @MaxLength(5000) details?: string | null;
  @IsOptional() @IsString() @MaxLength(5000) care?: string | null;
  @IsOptional() @IsString() @MaxLength(120) material?: string | null;
  @IsIn(['CLOTHING', 'SHOES', 'NONE']) sizeGuide: SizeGuide;
  @IsBoolean() exchangeable: boolean;
  @IsOptional() @IsBoolean() featured?: boolean;
  @IsIn(['DRAFT', 'LIVE', 'ARCHIVED']) status: ProductStatus;
  @IsArray() @IsString({ each: true }) collectionIds: string[];
  @IsArray() @ArrayMaxSize(12) @ValidateNested({ each: true }) @Type(() => ColourDto) colours: ColourDto[];
  @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) sizes: string[];
  @IsInt() @Min(0) basePriceKobo: number;
  @IsOptional() @IsInt() @Min(0) compareAtKobo?: number | null;
  @IsArray() @ArrayMaxSize(8) @ValidateNested({ each: true }) @Type(() => ImageDto) images: ImageDto[];
  /** Additions (optional): */
  @IsOptional() @IsInt() @Min(0) @Max(100000) initialStock?: number;
  @IsOptional() @IsInt() @Min(0) @Max(1000) lowStockThreshold?: number;
  @IsOptional() @IsString() @MaxLength(120) seoTitle?: string | null;
  @IsOptional() @IsString() @MaxLength(300) seoDescription?: string | null;
}

export class UpdateProductDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(80) slug?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(20) number?: string;
  @IsOptional() @IsString() @MaxLength(5000) description?: string;
  @IsOptional() @IsString() @MaxLength(5000) details?: string | null;
  @IsOptional() @IsString() @MaxLength(5000) care?: string | null;
  @IsOptional() @IsString() @MaxLength(120) material?: string | null;
  @IsOptional() @IsIn(['CLOTHING', 'SHOES', 'NONE']) sizeGuide?: SizeGuide;
  @IsOptional() @IsBoolean() exchangeable?: boolean;
  @IsOptional() @IsBoolean() featured?: boolean;
  @IsOptional() @IsIn(['DRAFT', 'LIVE', 'ARCHIVED']) status?: ProductStatus;
  @IsOptional() @IsArray() @IsString({ each: true }) collectionIds?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(12) @ValidateNested({ each: true }) @Type(() => ColourDto) colours?: ColourDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) sizes?: string[];
  @IsOptional() @IsInt() @Min(0) basePriceKobo?: number;
  @IsOptional() @IsInt() @Min(0) compareAtKobo?: number | null;
  @IsOptional() @IsArray() @ArrayMaxSize(8) @ValidateNested({ each: true }) @Type(() => ImageDto) images?: ImageDto[];
  @IsOptional() @IsInt() @Min(0) @Max(100000) initialStock?: number;
  @IsOptional() @IsInt() @Min(0) @Max(1000) lowStockThreshold?: number;
  @IsOptional() @IsString() @MaxLength(120) seoTitle?: string | null;
  @IsOptional() @IsString() @MaxLength(300) seoDescription?: string | null;
}

export class UpdateVariantDto {
  @IsOptional() @IsInt() @Min(0) priceKobo?: number;
  @IsOptional() @IsInt() @Min(0) compareAtKobo?: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(100000) stock?: number;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(60) sku?: string;
}

export class CollectionDto {
  @IsString() @IsNotEmpty() @MaxLength(80) name: string;
  @IsOptional() @IsString() @MaxLength(80) slug?: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string | null;
  @IsOptional() @IsBoolean() isDrop?: boolean;
  @IsOptional() @IsString() goLiveAt?: string | null;
  @IsOptional() @IsIn(['ADIRE', 'ASOOKE', null]) heroPattern?: 'ADIRE' | 'ASOOKE' | null;
  @IsOptional() @IsBoolean() exchangeable?: boolean;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsString() @MaxLength(2000) heroImageUrl?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(1000) homeOrder?: number | null;
  @IsOptional() @IsString() @MaxLength(80) tagline?: string | null;
}

export class UpdateCollectionDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(80) name?: string;
  @IsOptional() @IsString() @MaxLength(80) slug?: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string | null;
  @IsOptional() @IsBoolean() isDrop?: boolean;
  @IsOptional() @IsString() goLiveAt?: string | null;
  @IsOptional() @IsIn(['ADIRE', 'ASOOKE', null]) heroPattern?: 'ADIRE' | 'ASOOKE' | null;
  @IsOptional() @IsBoolean() exchangeable?: boolean;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsString() @MaxLength(2000) heroImageUrl?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(1000) homeOrder?: number | null;
  @IsOptional() @IsString() @MaxLength(80) tagline?: string | null;
}
