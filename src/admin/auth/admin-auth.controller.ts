import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/auth-types';
import { AdminAuthService } from './admin-auth.service';

class AdminLoginDto {
  @IsEmail() email: string;
  @IsString() @IsNotEmpty() @MaxLength(128) password: string;
}
class TotpDto {
  @IsString() @IsNotEmpty() tempToken: string;
  @IsString() @IsNotEmpty() @MaxLength(10) code: string;
}
class TotpEnableDto {
  @IsString() @IsNotEmpty() @MaxLength(10) code: string;
}

@Controller('admin/auth')
@Throttle({ default: { limit: 5, ttl: 60_000 } })
export class AdminAuthController {
  constructor(private readonly adminAuth: AdminAuthService) {}

  @Post('login')
  @HttpCode(200)
  login(@Body() dto: AdminLoginDto) {
    return this.adminAuth.login(dto.email, dto.password);
  }

  @Post('totp')
  @HttpCode(200)
  totp(@Body() dto: TotpDto) {
    return this.adminAuth.verifyTotp(dto.tempToken, dto.code);
  }

  @Post('totp/setup')
  @HttpCode(200)
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  setup(@CurrentUser() user: AuthUser) {
    return this.adminAuth.setup(user.id);
  }

  /** Addition: confirms enrolment with a first code; from then on login requires TOTP. */
  @Post('totp/enable')
  @HttpCode(200)
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  enable(@CurrentUser() user: AuthUser, @Body() dto: TotpEnableDto) {
    return this.adminAuth.enable(user.id, dto.code);
  }
}
