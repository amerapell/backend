import { IsBoolean, IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail() @MaxLength(254) email: string;
  @IsString() @MinLength(8) @MaxLength(128) password: string;
  @IsString() @IsNotEmpty() @MaxLength(80) firstName: string;
  @IsString() @IsNotEmpty() @MaxLength(80) lastName: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsBoolean() marketingConsent: boolean;
}

export class LoginDto {
  @IsEmail() email: string;
  @IsString() @IsNotEmpty() @MaxLength(128) password: string;
}

export class ForgotPasswordDto {
  @IsEmail() email: string;
}

export class ResetPasswordDto {
  @IsString() @IsNotEmpty() token: string;
  @IsString() @MinLength(8) @MaxLength(128) password: string;
}

export class VerifyEmailDto {
  @IsString() @IsNotEmpty() @MaxLength(256) token: string;
}

export class GoogleSignInDto {
  /** The Google Identity Services ID token (JWT) from the "Continue with Google" button. */
  @IsString() @IsNotEmpty() @MaxLength(4096) credential: string;
}
