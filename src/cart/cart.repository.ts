import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { DRIZZLE, Database } from '../db/database.module';
import { cartLines, carts, discounts } from '../db/schema';
import type { CartLineRow, CartRow } from '../db/schema';
import type { PromoRule } from './cart-math';

export const CART_REPOSITORY = Symbol('CART_REPOSITORY');

export interface Utm {
  source?: string | null;
  medium?: string | null;
  campaign?: string | null;
}

export type CartRecord = Pick<CartRow, 'id' | 'token' | 'userId' | 'promoCode' | 'utmSource' | 'utmMedium' | 'utmCampaign' | 'mergedIntoId'>;
export type CartLineRecord = Pick<CartLineRow, 'id' | 'cartId' | 'variantId' | 'quantity' | 'createdAt'>;

export interface CartRepository {
  create(data: { token: string; userId?: string | null; utm?: Utm }): Promise<CartRecord>;
  findByToken(token: string): Promise<CartRecord | null>;
  findByUserId(userId: string): Promise<CartRecord | null>;
  findById(id: string): Promise<CartRecord | null>;
  update(id: string, patch: Partial<Omit<CartRecord, 'id' | 'token'>>): Promise<void>;
  lines(cartId: string): Promise<CartLineRecord[]>;
  insertLine(cartId: string, variantId: string, quantity: number): Promise<CartLineRecord>;
  updateLine(lineId: string, patch: { variantId?: string; quantity?: number }): Promise<void>;
  deleteLine(lineId: string): Promise<void>;
  clearLines(cartId: string): Promise<void>;
  findPromo(code: string): Promise<PromoRule | null>;
}

@Injectable()
export class DrizzleCartRepository implements CartRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async create(data: { token: string; userId?: string | null; utm?: Utm }): Promise<CartRecord> {
    const [row] = await this.db
      .insert(carts)
      .values({
        token: data.token,
        userId: data.userId ?? null,
        utmSource: data.utm?.source ?? null,
        utmMedium: data.utm?.medium ?? null,
        utmCampaign: data.utm?.campaign ?? null,
      })
      .returning();
    return row;
  }

  async findByToken(token: string): Promise<CartRecord | null> {
    const [row] = await this.db.select().from(carts).where(eq(carts.token, token)).limit(1);
    return row ?? null;
  }

  async findByUserId(userId: string): Promise<CartRecord | null> {
    const [row] = await this.db
      .select()
      .from(carts)
      .where(and(eq(carts.userId, userId), isNull(carts.mergedIntoId)))
      .orderBy(desc(carts.updatedAt))
      .limit(1);
    return row ?? null;
  }

  async findById(id: string): Promise<CartRecord | null> {
    const [row] = await this.db.select().from(carts).where(eq(carts.id, id)).limit(1);
    return row ?? null;
  }

  async update(id: string, patch: Partial<Omit<CartRecord, 'id' | 'token'>>): Promise<void> {
    await this.db.update(carts).set({ ...patch, updatedAt: new Date() }).where(eq(carts.id, id));
  }

  lines(cartId: string): Promise<CartLineRecord[]> {
    return this.db.select().from(cartLines).where(eq(cartLines.cartId, cartId)).orderBy(asc(cartLines.createdAt));
  }

  async insertLine(cartId: string, variantId: string, quantity: number): Promise<CartLineRecord> {
    const [row] = await this.db
      .insert(cartLines)
      .values({ cartId, variantId, quantity })
      .onConflictDoUpdate({ target: [cartLines.cartId, cartLines.variantId], set: { quantity } })
      .returning();
    await this.db.update(carts).set({ updatedAt: new Date() }).where(eq(carts.id, cartId));
    return row;
  }

  async updateLine(lineId: string, patch: { variantId?: string; quantity?: number }): Promise<void> {
    await this.db.update(cartLines).set(patch).where(eq(cartLines.id, lineId));
  }

  async deleteLine(lineId: string): Promise<void> {
    await this.db.delete(cartLines).where(eq(cartLines.id, lineId));
  }

  async clearLines(cartId: string): Promise<void> {
    await this.db.delete(cartLines).where(eq(cartLines.cartId, cartId));
  }

  async findPromo(code: string): Promise<PromoRule | null> {
    const [row] = await this.db.select().from(discounts).where(eq(discounts.code, code.trim().toUpperCase())).limit(1);
    return row ?? null;
  }
}
