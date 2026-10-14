import { BadRequestException, Body, ConflictException, Delete, Get, HttpCode, Inject, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import type { DiscountRow } from '../../db/schema';
import type { DiscountType, StoreSettings } from '../../common/contract';
import { SettingsService } from '../../settings/settings.service';
import { CONTENT_REPOSITORY, ContentRepository, DELIVERY_ZONES_REPOSITORY, DeliveryZonesRepository } from '../../content/content.repository';
import { toDeliveryZone } from '../../content/content.service';
import { AdminController } from '../admin-controller.decorator';
import { DISCOUNTS_REPOSITORY, DiscountInput, DiscountsRepository } from './discounts.repository';
import { DiscountDto, FaqDto, UpdateDiscountDto, UpdateFaqDto, UpdatePageDto, UpdateSettingsDto, UpdateZoneDto } from './admin-content.dto';

function date(v: string | null | undefined, field: string): Date | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new BadRequestException(`${field} must be an ISO 8601 date`);
  return d;
}

function checkValue(type: DiscountType, value: number): number {
  if (type === 'PERCENT' && (value < 1 || value > 100)) throw new BadRequestException('A percentage discount must be between 1 and 100');
  if (type === 'FIXED' && value < 1) throw new BadRequestException('A fixed discount must be at least 1 kobo');
  return type === 'FREE_DELIVERY' ? 0 : value;
}

function presentDiscount(d: DiscountRow) {
  return {
    ...d,
    startsAt: d.startsAt?.toISOString() ?? null,
    endsAt: d.endsAt?.toISOString() ?? null,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

@AdminController('discounts')
export class AdminDiscountsController {
  constructor(@Inject(DISCOUNTS_REPOSITORY) private readonly repo: DiscountsRepository) {}

  @Get()
  async list() {
    return (await this.repo.list()).map(presentDiscount);
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const d = await this.repo.find(id);
    if (!d) throw new NotFoundException('Discount not found');
    return presentDiscount(d);
  }

  @Post()
  @HttpCode(201)
  async create(@Body() dto: DiscountDto) {
    const code = dto.code.toUpperCase();
    if (await this.repo.findByCode(code)) throw new ConflictException('A discount with this code already exists');
    const d = await this.repo.create({
      code,
      type: dto.type,
      value: checkValue(dto.type, dto.value),
      startsAt: date(dto.startsAt, 'startsAt') ?? null,
      endsAt: date(dto.endsAt, 'endsAt') ?? null,
      maxUses: dto.maxUses ?? null,
      minSubtotalKobo: dto.minSubtotalKobo ?? null,
      active: dto.active ?? true,
    });
    return presentDiscount(d);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateDiscountDto) {
    const current = await this.repo.find(id);
    if (!current) throw new NotFoundException('Discount not found');
    const patch: Partial<DiscountInput> = {};
    if (dto.code !== undefined) {
      const code = dto.code.toUpperCase();
      const clash = await this.repo.findByCode(code);
      if (clash && clash.id !== id) throw new ConflictException('A discount with this code already exists');
      patch.code = code;
    }
    const type = dto.type ?? current.type;
    if (dto.type !== undefined) patch.type = dto.type;
    if (dto.value !== undefined || dto.type !== undefined) patch.value = checkValue(type, dto.value ?? current.value);
    const s = date(dto.startsAt, 'startsAt');
    if (s !== undefined) patch.startsAt = s;
    const e = date(dto.endsAt, 'endsAt');
    if (e !== undefined) patch.endsAt = e;
    if (dto.maxUses !== undefined) patch.maxUses = dto.maxUses;
    if (dto.minSubtotalKobo !== undefined) patch.minSubtotalKobo = dto.minSubtotalKobo;
    if (dto.active !== undefined) patch.active = dto.active;
    const d = await this.repo.update(id, patch);
    return presentDiscount(d as DiscountRow);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    if (!(await this.repo.delete(id))) throw new NotFoundException('Discount not found');
    return { ok: true };
  }
}

@AdminController('delivery-zones')
export class AdminDeliveryZonesController {
  constructor(@Inject(DELIVERY_ZONES_REPOSITORY) private readonly zones: DeliveryZonesRepository) {}

  @Get()
  async list() {
    return (await this.zones.list()).map((z) => ({ ...toDeliveryZone(z), sortOrder: z.sortOrder }));
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const z = await this.zones.findById(id);
    if (!z) throw new NotFoundException('Delivery zone not found');
    return { ...toDeliveryZone(z), sortOrder: z.sortOrder };
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateZoneDto) {
    const z = await this.zones.update(id, dto);
    if (!z) throw new NotFoundException('Delivery zone not found');
    return { ...toDeliveryZone(z), sortOrder: z.sortOrder };
  }
}

@AdminController('settings')
export class AdminSettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  get() {
    return this.settings.getPublic();
  }

  @Patch()
  update(@Body() dto: UpdateSettingsDto) {
    if (dto.drop?.goLiveAt) date(dto.drop.goLiveAt, 'drop.goLiveAt');
    return this.settings.update(dto as Partial<StoreSettings>);
  }
}

@AdminController('faq')
export class AdminFaqController {
  constructor(@Inject(CONTENT_REPOSITORY) private readonly content: ContentRepository) {}

  @Get()
  list() {
    return this.content.faq();
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const f = await this.content.findFaq(id);
    if (!f) throw new NotFoundException('FAQ item not found');
    return f;
  }

  @Post()
  @HttpCode(201)
  create(@Body() dto: FaqDto) {
    return this.content.createFaq(dto);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateFaqDto) {
    const f = await this.content.updateFaq(id, dto);
    if (!f) throw new NotFoundException('FAQ item not found');
    return f;
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    if (!(await this.content.deleteFaq(id))) throw new NotFoundException('FAQ item not found');
    return { ok: true };
  }
}

@AdminController('pages')
export class AdminPagesController {
  constructor(@Inject(CONTENT_REPOSITORY) private readonly content: ContentRepository) {}

  /** Addition: list all pages. */
  @Get()
  list() {
    return this.content.pages();
  }

  @Get(':slug')
  async get(@Param('slug') slug: string) {
    const p = await this.content.page(slug);
    if (!p) throw new NotFoundException('Page not found');
    return p;
  }

  @Patch(':slug')
  async update(@Param('slug') slug: string, @Body() dto: UpdatePageDto) {
    if (!/^[a-z0-9-]{2,60}$/.test(slug)) throw new BadRequestException('Invalid page slug');
    const current = await this.content.page(slug);
    if (!current && (!dto.title || dto.bodyMarkdown === undefined)) throw new BadRequestException('title and bodyMarkdown are required for a new page');
    return this.content.upsertPage(slug, {
      title: dto.title ?? (current?.title as string),
      bodyMarkdown: dto.bodyMarkdown ?? (current?.bodyMarkdown as string),
    });
  }
}
