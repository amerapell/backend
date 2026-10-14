import { BadRequestException, Body, Get, HttpCode, Inject, NotFoundException, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/auth-types';
import { ORDER_STATUSES } from '../../common/contract';
import type { OrderStatus, PaymentProviderName } from '../../common/contract';
import { parsePage } from '../../common/pagination';
import { ORDERS_REPOSITORY, OrdersRepository } from '../../orders/orders.repository';
import { OrdersService } from '../../orders/orders.service';
import { OrderLifecycleService } from '../../orders/order-lifecycle.service';
import { PaymentsService } from '../../payments/payments.service';
import { SettingsService } from '../../settings/settings.service';
import { ExchangesService } from '../../exchanges/exchanges.service';
import { ExchangeActionDto } from '../../exchanges/exchanges.dto';
import { EXCHANGE_STATUSES } from '../../common/contract';
import type { ExchangeStatus } from '../../common/contract';
import { AdminController } from '../admin-controller.decorator';
import { renderPackingSlip } from './packing-slip';

class UpdateOrderDto {
  @IsOptional() @IsIn(ORDER_STATUSES) status?: OrderStatus;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
}

const PROVIDERS: PaymentProviderName[] = ['PAYSTACK', 'BACHS', 'CREDIT'];

@AdminController('orders')
export class AdminOrdersController {
  constructor(
    @Inject(ORDERS_REPOSITORY) private readonly repo: OrdersRepository,
    private readonly orders: OrdersService,
    private readonly lifecycle: OrderLifecycleService,
    private readonly payments: PaymentsService,
    private readonly settings: SettingsService,
  ) {}

  @Get()
  async list(@Query() q: Record<string, string | undefined>) {
    if (q.status && !ORDER_STATUSES.includes(q.status as OrderStatus)) throw new BadRequestException('Invalid status');
    if (q.provider && !PROVIDERS.includes(q.provider as PaymentProviderName)) throw new BadRequestException('Invalid provider');
    const page = parsePage(q.page, q.pageSize, 50, 200);
    const { rows, total } = await this.repo.adminList({
      status: q.status as OrderStatus | undefined,
      provider: q.provider as PaymentProviderName | undefined,
      q: q.q?.trim() || undefined,
      ...page,
    });
    const items = await this.orders.presentMany(rows);
    return {
      items: items.map((o, i) => ({ ...o, utmSource: rows[i].utmSource })),
      page: page.page,
      pageSize: page.pageSize,
      total,
    };
  }

  private async detail(id: string) {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundException('Order not found');
    const [order, notes] = await Promise.all([this.orders.present(row), this.repo.notes(id)]);
    return {
      ...order,
      userId: row.userId,
      discountCode: row.discountCode,
      marketingConsent: row.marketingConsent,
      utm: { source: row.utmSource, medium: row.utmMedium, campaign: row.utmCampaign },
      notes: notes.map((n) => ({ ...n, createdAt: n.createdAt.toISOString() })),
    };
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.detail(id);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateOrderDto, @CurrentUser() user: AuthUser) {
    if (!(await this.repo.findById(id))) throw new NotFoundException('Order not found');
    if (dto.note?.trim()) await this.repo.addNote(id, dto.note.trim(), user.email);
    if (dto.status) await this.lifecycle.adminSetStatus(id, dto.status);
    return this.detail(id);
  }

  /** HTML print view; `?format=json` returns the same data as JSON. */
  @Get(':id/packing-slip')
  async packingSlip(@Param('id') id: string, @Res({ passthrough: true }) res: Response, @Query('format') format?: string) {
    const d = await this.detail(id);
    if (format === 'json') return d;
    res.type('html');
    return renderPackingSlip(d, d.notes, await this.settings.get());
  }

  /** Addition (PAY-7, P1): provider refund for a cancelled paid order the store could not fulfil. */
  @Post(':id/refund')
  @HttpCode(200)
  async refund(@Param('id') id: string) {
    await this.payments.refund(id);
    return this.detail(id);
  }
}

@AdminController('exchanges')
export class AdminExchangesController {
  constructor(private readonly exchanges: ExchangesService) {}

  @Get()
  list(@Query('status') status?: string) {
    if (status && !EXCHANGE_STATUSES.includes(status as ExchangeStatus)) throw new BadRequestException('Invalid status');
    return this.exchanges.adminList(status as ExchangeStatus | undefined);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.exchanges.get(id);
  }

  @Post(':id/approve')
  @HttpCode(200)
  approve(@Param('id') id: string, @Body() dto: ExchangeActionDto) {
    return this.exchanges.approve(id, dto.note);
  }

  @Post(':id/decline')
  @HttpCode(200)
  decline(@Param('id') id: string, @Body() dto: ExchangeActionDto) {
    return this.exchanges.decline(id, dto.note);
  }

  @Post(':id/receive')
  @HttpCode(200)
  receive(@Param('id') id: string, @Body() dto: ExchangeActionDto) {
    return this.exchanges.receive(id, dto.note);
  }

  @Post(':id/complete')
  @HttpCode(200)
  complete(@Param('id') id: string, @Body() dto: ExchangeActionDto) {
    return this.exchanges.complete(id, dto.note);
  }
}
