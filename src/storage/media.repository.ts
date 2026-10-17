import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, lt, sql } from 'drizzle-orm';
import { DRIZZLE, Database } from '../db/database.module';
import { mediaFiles, mediaVariants } from '../db/schema';

export const MEDIA_REPOSITORY = Symbol('MEDIA_REPOSITORY');

export type MediaOwnerKind = 'product' | 'exchange';

export interface NewMedia {
  ownerKind: MediaOwnerKind;
  originalFilename: string | null;
  width: number;
  height: number;
  variants: { width: number; mime: string; bytes: Buffer }[];
}

export interface StoredVariant {
  width: number;
  mime: string;
  bytes: Buffer;
}

export interface MediaRepository {
  /** Persists the file + all variants atomically; returns the new media id. */
  create(media: NewMedia): Promise<string>;
  /** Stored variant widths for a media id, ascending; empty when unknown. */
  variantWidths(mediaId: string): Promise<number[]>;
  variant(mediaId: string, width: number): Promise<StoredVariant | null>;
  /**
   * Housekeeping: deletes product media no product_images row references any more, created before `olderThan`
   * (the grace period covers images uploaded in the editor but not saved yet). Returns the number deleted.
   * Not scheduled yet — call from a one-off script or future cron.
   */
  deleteUnreferencedProductMedia(olderThan: Date): Promise<number>;
}

/** Picks the smallest stored width ≥ `requested`; falls back to the largest. No request → largest. */
export function pickVariantWidth(widths: number[], requested?: number): number | null {
  if (!widths.length) return null;
  const sorted = [...widths].sort((a, b) => a - b);
  if (!requested || !Number.isFinite(requested) || requested <= 0) return sorted[sorted.length - 1];
  return sorted.find((w) => w >= requested) ?? sorted[sorted.length - 1];
}

@Injectable()
export class DrizzleMediaRepository implements MediaRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async create(media: NewMedia): Promise<string> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(mediaFiles)
        .values({ ownerKind: media.ownerKind, originalFilename: media.originalFilename, width: media.width, height: media.height })
        .returning({ id: mediaFiles.id });
      await tx.insert(mediaVariants).values(
        media.variants.map((v) => ({ mediaId: row.id, width: v.width, mime: v.mime, bytes: v.bytes, byteSize: v.bytes.length })),
      );
      return row.id;
    });
  }

  async variantWidths(mediaId: string): Promise<number[]> {
    const rows = await this.db
      .select({ width: mediaVariants.width })
      .from(mediaVariants)
      .where(eq(mediaVariants.mediaId, mediaId))
      .orderBy(asc(mediaVariants.width));
    return rows.map((r) => r.width);
  }

  async variant(mediaId: string, width: number): Promise<StoredVariant | null> {
    const [row] = await this.db
      .select({ width: mediaVariants.width, mime: mediaVariants.mime, bytes: mediaVariants.bytes })
      .from(mediaVariants)
      .where(and(eq(mediaVariants.mediaId, mediaId), eq(mediaVariants.width, width)))
      .limit(1);
    return row ?? null;
  }

  async deleteUnreferencedProductMedia(olderThan: Date): Promise<number> {
    const deleted = await this.db
      .delete(mediaFiles)
      .where(
        and(
          eq(mediaFiles.ownerKind, 'product'),
          lt(mediaFiles.createdAt, olderThan),
          sql`not exists (select 1 from product_images pi where pi.url like '%/api/v1/media/' || ${mediaFiles.id} || '%')`,
        ),
      )
      .returning({ id: mediaFiles.id });
    return deleted.length;
  }
}
