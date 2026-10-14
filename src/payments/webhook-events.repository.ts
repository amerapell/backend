import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE, Database } from '../db/database.module';
import { webhookEvents } from '../db/schema';
import type { ProviderCode } from '../common/contract';

export const WEBHOOK_EVENTS_REPOSITORY = Symbol('WEBHOOK_EVENTS_REPOSITORY');

export interface RecordedEvent {
  id: string;
  /** True when this (provider, eventId) was already processed successfully — skip it. */
  alreadyProcessed: boolean;
}

export interface WebhookEventsRepository {
  record(provider: ProviderCode, eventId: string, type: string, payload: unknown): Promise<RecordedEvent>;
  markProcessed(id: string): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
}

/** PAY-5: unique (provider, event_id) — the same event twice never double-processes. */
@Injectable()
export class DrizzleWebhookEventsRepository implements WebhookEventsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async record(provider: ProviderCode, eventId: string, type: string, payload: unknown): Promise<RecordedEvent> {
    const inserted = await this.db
      .insert(webhookEvents)
      .values({ provider, eventId, type, payload: payload as object })
      .onConflictDoNothing({ target: [webhookEvents.provider, webhookEvents.eventId] })
      .returning({ id: webhookEvents.id });
    if (inserted[0]) return { id: inserted[0].id, alreadyProcessed: false };
    const [existing] = await this.db
      .select({ id: webhookEvents.id, processedAt: webhookEvents.processedAt })
      .from(webhookEvents)
      .where(and(eq(webhookEvents.provider, provider), eq(webhookEvents.eventId, eventId)))
      .limit(1);
    return { id: existing.id, alreadyProcessed: existing.processedAt !== null };
  }

  async markProcessed(id: string): Promise<void> {
    await this.db.update(webhookEvents).set({ processedAt: new Date(), error: null }).where(eq(webhookEvents.id, id));
  }

  async markFailed(id: string, error: string): Promise<void> {
    await this.db.update(webhookEvents).set({ error: error.slice(0, 2000) }).where(eq(webhookEvents.id, id));
  }
}
