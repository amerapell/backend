import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard, OptionalJwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/auth-types';
import { IMAGE_UPLOADER, ImageUploader } from '../storage/storage.types';
import { ExchangesService } from './exchanges.service';
import { CreateExchangeDto } from './exchanges.dto';

const IMAGE_TYPES = /^image\/(jpeg|png|webp|heic|heif)$/;

@Controller()
export class ExchangesController {
  constructor(
    private readonly exchanges: ExchangesService,
    @Inject(IMAGE_UPLOADER) private readonly uploader: ImageUploader,
  ) {}

  @Get('me/exchanges')
  @UseGuards(JwtAuthGuard)
  mine(@CurrentUser() user: AuthUser) {
    return this.exchanges.forCustomer(user);
  }

  @Post('exchanges')
  @HttpCode(201)
  @UseGuards(OptionalJwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  create(@Body() dto: CreateExchangeDto, @CurrentUser() user: AuthUser | undefined) {
    if (!user && !dto.email) throw new BadRequestException('Sign in or enter the email used for the order');
    return this.exchanges.request(dto, user);
  }

  @Post('uploads/exchange-photo')
  @HttpCode(201)
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 8 * 1024 * 1024, files: 1 } }))
  async upload(@UploadedFile() file: Express.Multer.File | undefined) {
    if (!file) throw new BadRequestException('Attach an image as "file"');
    if (!IMAGE_TYPES.test(file.mimetype)) throw new BadRequestException('Upload a JPEG, PNG, WebP or HEIC image');
    return this.uploader.upload(file, 'amerapelle/exchanges');
  }
}
