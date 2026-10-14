import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { OrdersService } from './orders.service';

export class OrderLookupDto {
  @IsString() @IsNotEmpty() @MaxLength(20) number: string;
  @IsEmail() email: string;
}

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post('lookup')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  lookup(@Body() dto: OrderLookupDto) {
    return this.orders.lookup(dto.number, dto.email);
  }
}
