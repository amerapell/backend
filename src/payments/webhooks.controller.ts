import { Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { PaymentsService } from './payments.service';

/** Webhooks read the RAW body (NestFactory rawBody: true) — signatures are computed over exact bytes. */
@Controller('payments/webhooks')
@SkipThrottle()
export class WebhooksController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('paystack')
  @HttpCode(200)
  paystack(@Req() req: RawBodyRequest<Request>) {
    return this.payments.handleWebhook('PAYSTACK', req.rawBody, req.headers);
  }

  @Post('bachs')
  @HttpCode(200)
  bachs(@Req() req: RawBodyRequest<Request>) {
    return this.payments.handleWebhook('BACHS', req.rawBody, req.headers);
  }
}
