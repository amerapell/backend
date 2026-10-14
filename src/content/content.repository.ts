import { Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { DRIZZLE, Database } from '../db/database.module';
import { contactMessages, deliveryZones, dropNotifications, faqItems, newsletterSubscribers, pages } from '../db/schema';
import type { DeliveryZoneRow, FaqItemRow, PageRow } from '../db/schema';
import type { ZoneCode } from '../common/contract';

export const CONTENT_REPOSITORY = Symbol('CONTENT_REPOSITORY');
export const DELIVERY_ZONES_REPOSITORY = Symbol('DELIVERY_ZONES_REPOSITORY');

export interface ContentRepository {
  faq(): Promise<FaqItemRow[]>;
  findFaq(id: string): Promise<FaqItemRow | null>;
  createFaq(data: { group: string; question: string; answer: string; sortOrder?: number }): Promise<FaqItemRow>;
  updateFaq(id: string, data: Partial<{ group: string; question: string; answer: string; sortOrder: number }>): Promise<FaqItemRow | null>;
  deleteFaq(id: string): Promise<boolean>;
  pages(): Promise<PageRow[]>;
  page(slug: string): Promise<PageRow | null>;
  upsertPage(slug: string, data: { title: string; bodyMarkdown: string }): Promise<PageRow>;
  subscribe(email: string, consent: boolean, source: string): Promise<void>;
  unsubscribe(email: string): Promise<void>;
  isSubscribed(email: string): Promise<boolean>;
  notifyDrop(contact: string, collectionSlug: string): Promise<void>;
  saveContact(msg: { name: string; email: string; phone: string | null; subject: string; message: string }): Promise<void>;
}

export interface DeliveryZonesRepository {
  list(): Promise<DeliveryZoneRow[]>;
  findByCode(code: ZoneCode): Promise<DeliveryZoneRow | null>;
  findById(id: string): Promise<DeliveryZoneRow | null>;
  update(id: string, data: Partial<Pick<DeliveryZoneRow, 'name' | 'etaText' | 'feeKobo' | 'active' | 'sortOrder'>>): Promise<DeliveryZoneRow | null>;
}

@Injectable()
export class DrizzleContentRepository implements ContentRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  faq() {
    return this.db.select().from(faqItems).orderBy(asc(faqItems.group), asc(faqItems.sortOrder), asc(faqItems.createdAt));
  }
  async findFaq(id: string) {
    const [r] = await this.db.select().from(faqItems).where(eq(faqItems.id, id)).limit(1);
    return r ?? null;
  }
  async createFaq(data: { group: string; question: string; answer: string; sortOrder?: number }) {
    const [r] = await this.db.insert(faqItems).values(data).returning();
    return r;
  }
  async updateFaq(id: string, data: Partial<{ group: string; question: string; answer: string; sortOrder: number }>) {
    const [r] = await this.db.update(faqItems).set(data).where(eq(faqItems.id, id)).returning();
    return r ?? null;
  }
  async deleteFaq(id: string) {
    const r = await this.db.delete(faqItems).where(eq(faqItems.id, id)).returning({ id: faqItems.id });
    return r.length > 0;
  }
  pages() {
    return this.db.select().from(pages).orderBy(asc(pages.slug));
  }
  async page(slug: string) {
    const [r] = await this.db.select().from(pages).where(eq(pages.slug, slug)).limit(1);
    return r ?? null;
  }
  async upsertPage(slug: string, data: { title: string; bodyMarkdown: string }) {
    const [r] = await this.db
      .insert(pages)
      .values({ slug, ...data })
      .onConflictDoUpdate({ target: pages.slug, set: { ...data, updatedAt: new Date() } })
      .returning();
    return r;
  }
  async subscribe(email: string, consent: boolean, source: string) {
    await this.db
      .insert(newsletterSubscribers)
      .values({ email: email.toLowerCase(), consent, source })
      .onConflictDoUpdate({ target: newsletterSubscribers.email, set: { consent } });
  }
  async unsubscribe(email: string) {
    await this.db.delete(newsletterSubscribers).where(eq(newsletterSubscribers.email, email.toLowerCase()));
  }
  async isSubscribed(email: string) {
    const [r] = await this.db.select().from(newsletterSubscribers).where(eq(newsletterSubscribers.email, email.toLowerCase())).limit(1);
    return !!r?.consent;
  }
  async notifyDrop(contact: string, collectionSlug: string) {
    await this.db.insert(dropNotifications).values({ contact, collectionSlug }).onConflictDoNothing();
  }
  async saveContact(msg: { name: string; email: string; phone: string | null; subject: string; message: string }) {
    await this.db.insert(contactMessages).values(msg);
  }
}

@Injectable()
export class DrizzleDeliveryZonesRepository implements DeliveryZonesRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  list() {
    return this.db.select().from(deliveryZones).orderBy(asc(deliveryZones.sortOrder));
  }
  async findByCode(code: ZoneCode) {
    const [r] = await this.db.select().from(deliveryZones).where(eq(deliveryZones.code, code)).limit(1);
    return r ?? null;
  }
  async findById(id: string) {
    const [r] = await this.db.select().from(deliveryZones).where(eq(deliveryZones.id, id)).limit(1);
    return r ?? null;
  }
  async update(id: string, data: Partial<Pick<DeliveryZoneRow, 'name' | 'etaText' | 'feeKobo' | 'active' | 'sortOrder'>>) {
    const [r] = await this.db.update(deliveryZones).set(data).where(eq(deliveryZones.id, id)).returning();
    return r ?? null;
  }
}
