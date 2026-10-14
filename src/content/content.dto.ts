import { Equals, IsBoolean, IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class ContactDto {
  @IsString() @IsNotEmpty() @MaxLength(120) name: string;
  @IsEmail() email: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsString() @IsNotEmpty() @MaxLength(200) subject: string;
  @IsString() @IsNotEmpty() @MaxLength(5000) message: string;
}

export class NewsletterDto {
  @IsEmail() email: string;
  @IsBoolean() @Equals(true, { message: 'consent must be true' }) consent: boolean;
}

export class DropNotifyDto {
  @IsString() @IsNotEmpty() @MaxLength(200) contact: string;
  @IsString() @IsNotEmpty() @MaxLength(120) collectionSlug: string;
}
