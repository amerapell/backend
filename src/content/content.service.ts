import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { DeliveryZone } from '../common/contract';
import type { DeliveryZoneRow } from '../db/schema';
import { normalizeNigerianPhone } from '../common/phone';
import { NotificationsService } from '../email/notifications.service';
import { CONTENT_REPOSITORY, ContentRepository, DELIVERY_ZONES_REPOSITORY, DeliveryZonesRepository } from './content.repository';

export const FAQ_GROUP_ORDER = ['Orders', 'Delivery', 'Payments', 'Exchanges', 'Sizing', 'Authenticity'];
export const PAGE_SLUGS = ['about', 'delivery', 'exchanges', 'privacy', 'terms'];

export function toDeliveryZone(z: DeliveryZoneRow): DeliveryZone {
  return { id: z.id, code: z.code, name: z.name, etaText: z.etaText, feeKobo: z.feeKobo, active: z.active };
}

@Injectable()
export class ContentService {
  constructor(
    @Inject(CONTENT_REPOSITORY) private readonly repo: ContentRepository,
    @Inject(DELIVERY_ZONES_REPOSITORY) private readonly zones: DeliveryZonesRepository,
    private readonly notifications: NotificationsService,
  ) {}

  async faq(): Promise<{ group: string; items: { id: string; question: string; answer: string }[] }[]> {
    const rows = await this.repo.faq();
    const groups = new Map<string, { id: string; question: string; answer: string }[]>();
    for (const r of rows) {
      if (!groups.has(r.group)) groups.set(r.group, []);
      groups.get(r.group)?.push({ id: r.id, question: r.question, answer: r.answer });
    }
    const rank = (g: string) => (FAQ_GROUP_ORDER.indexOf(g) === -1 ? 99 : FAQ_GROUP_ORDER.indexOf(g));
    return [...groups.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0])).map(([group, items]) => ({ group, items }));
  }

  async page(slug: string) {
    const p = await this.repo.page(slug);
    if (!p) throw new NotFoundException('Page not found');
    return { slug: p.slug, title: p.title, bodyMarkdown: p.bodyMarkdown, updatedAt: p.updatedAt.toISOString() };
  }

  async contact(msg: { name: string; email: string; phone?: string; subject: string; message: string }) {
    const phone = msg.phone ? normalizeNigerianPhone(msg.phone) ?? msg.phone.trim() : null;
    const clean = { name: msg.name.trim(), email: msg.email.trim().toLowerCase(), phone, subject: msg.subject.trim(), message: msg.message.trim() };
    await this.repo.saveContact(clean);
    await this.notifications.contactForm(clean);
    return { ok: true as const };
  }

  async newsletter(email: string, consent: boolean, source = 'newsletter') {
    if (consent !== true) throw new BadRequestException('Marketing consent is required to subscribe');
    await this.repo.subscribe(email.trim(), true, source);
    return { ok: true as const };
  }

  async notifyDrop(contact: string, collectionSlug: string) {
    const c = contact.trim();
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c);
    const phone = isEmail ? null : normalizeNigerianPhone(c) ?? (/^\+\d{8,15}$/.test(c.replace(/[\s-]/g, '')) ? c.replace(/[\s-]/g, '') : null);
    if (!isEmail && !phone) throw new BadRequestException('Enter an email address or phone number');
    await this.repo.notifyDrop(isEmail ? c.toLowerCase() : (phone as string), collectionSlug);
    return { ok: true as const };
  }

  async activeZones(): Promise<DeliveryZone[]> {
    return (await this.zones.list()).filter((z) => z.active).map(toDeliveryZone);
  }
}
