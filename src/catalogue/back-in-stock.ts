import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { DRIZZLE, Database } from '../db/database.module';
import { NotificationsService } from '../email/notifications.service';
import type { BackInStockItem } from '../email/templates';

export const BACK_IN_STOCK_REPOSITORY = Symbol('BACK_IN_STOCK_REPOSITORY');

export interface DueStockAlert extends BackInStockItem {
  id: string;
  email: string;
}

export interface BackInStockRepository {
  /**
   * Atomically claims (marks notified) up to `limit` "notify me" sign-ups whose size is available again on a live
   * product, and returns them. Claiming before sending means two servers can never email the same person twice.
   */
  claimDue(limit: number): Promise<DueStockAlert[]>;
}

@Injectable()
export class DrizzleBackInStockRepository implements BackInStockRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async claimDue(limit: number): Promise<DueStockAlert[]> {
    const res = await this.db.execute<{
      id: string;
      email: string;
      product_name: string;
      product_slug: string;
      colour: string | null;
      size: string | null;
      price_kobo: number;
      image_url: string | null;
    }>(sql`
      WITH due AS (
        SELECT sn.id
        FROM stock_notifications sn
        JOIN variants v ON v.id = sn.variant_id
        JOIN products p ON p.id = sn.product_id
        WHERE sn.notified_at IS NULL
          AND p.status = 'LIVE'
          AND v.archived = false
          AND v.stock - COALESCE((
            SELECT SUM(h.quantity) FROM stock_holds h
            WHERE h.variant_id = v.id AND h.released_at IS NULL AND h.consumed_at IS NULL
          ), 0) > 0
        ORDER BY sn.created_at
        LIMIT ${limit}
        FOR UPDATE OF sn SKIP LOCKED
      ),
      claimed AS (
        UPDATE stock_notifications s SET notified_at = now() FROM due WHERE s.id = due.id
        RETURNING s.id, s.email, s.product_id, s.variant_id
      )
      SELECT c.id, c.email, p.name AS product_name, p.slug AS product_slug, v.colour, v.size, v.price_kobo,
        (SELECT pi.url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.sort_order LIMIT 1) AS image_url
      FROM claimed c
      JOIN products p ON p.id = c.product_id
      JOIN variants v ON v.id = c.variant_id
    `);
    return res.rows.map((r) => ({
      id: r.id,
      email: r.email,
      productName: r.product_name,
      productSlug: r.product_slug,
      colour: r.colour,
      size: r.size,
      priceKobo: Number(r.price_kobo),
      imageUrl: r.image_url,
    }));
  }
}

/** "Notify me when available": emails each sign-up once, as soon as their size can be bought again. */
@Injectable()
export class BackInStockService {
  private readonly logger = new Logger('BackInStock');
  private running = false;

  constructor(
    @Inject(BACK_IN_STOCK_REPOSITORY) private readonly repo: BackInStockRepository,
    private readonly notifications: NotificationsService,
  ) {}

  /** Restocks happen from many places (admin edits, CSV import, exchanges, released holds) — so check on a timer. */
  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'back-in-stock' })
  async tick(): Promise<void> {
    if (this.running || process.env.DISABLE_CRON === 'true') return;
    this.running = true;
    try {
      const sent = await this.run();
      if (sent) this.logger.log(`Back-in-stock emails sent: ${sent}`);
    } catch (err) {
      this.logger.error(`Back-in-stock run failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  async run(limit = 100): Promise<number> {
    const due = await this.repo.claimDue(limit);
    for (const a of due) await this.notifications.backInStock(a.email, a);
    return due.length;
  }
}
