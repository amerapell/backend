import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq } from 'drizzle-orm';
import { DRIZZLE, Database } from '../db/database.module';
import { addresses, carts, newsletterSubscribers, orders, refreshTokens, users, wishlistItems } from '../db/schema';
import type { AddressRow } from '../db/schema';

export const ME_REPOSITORY = Symbol('ME_REPOSITORY');

export type AddressInput = Omit<AddressRow, 'id' | 'userId' | 'createdAt' | 'updatedAt'>;

export interface MeRepository {
  addresses(userId: string): Promise<AddressRow[]>;
  findAddress(userId: string, id: string): Promise<AddressRow | null>;
  createAddress(userId: string, data: AddressInput): Promise<AddressRow>;
  updateAddress(userId: string, id: string, data: Partial<AddressInput>): Promise<AddressRow | null>;
  deleteAddress(userId: string, id: string): Promise<boolean>;
  wishlistProductIds(userId: string): Promise<string[]>;
  addWishlist(userId: string, productId: string): Promise<void>;
  removeWishlist(userId: string, productId: string): Promise<void>;
  /** NDPA erasure: anonymise the account and personal data on its orders; keeps order financials. */
  anonymise(userId: string, oldEmail: string, anonEmail: string, at: Date): Promise<void>;
}

@Injectable()
export class DrizzleMeRepository implements MeRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  addresses(userId: string) {
    return this.db.select().from(addresses).where(eq(addresses.userId, userId)).orderBy(desc(addresses.updatedAt));
  }
  async findAddress(userId: string, id: string) {
    const [r] = await this.db.select().from(addresses).where(and(eq(addresses.userId, userId), eq(addresses.id, id))).limit(1);
    return r ?? null;
  }
  async createAddress(userId: string, data: AddressInput) {
    const [r] = await this.db.insert(addresses).values({ ...data, userId }).returning();
    return r;
  }
  async updateAddress(userId: string, id: string, data: Partial<AddressInput>) {
    const [r] = await this.db.update(addresses).set(data).where(and(eq(addresses.userId, userId), eq(addresses.id, id))).returning();
    return r ?? null;
  }
  async deleteAddress(userId: string, id: string) {
    const r = await this.db.delete(addresses).where(and(eq(addresses.userId, userId), eq(addresses.id, id))).returning({ id: addresses.id });
    return r.length > 0;
  }
  async wishlistProductIds(userId: string) {
    const rows = await this.db.select({ id: wishlistItems.productId }).from(wishlistItems).where(eq(wishlistItems.userId, userId)).orderBy(asc(wishlistItems.createdAt));
    return rows.map((r) => r.id);
  }
  async addWishlist(userId: string, productId: string) {
    await this.db.insert(wishlistItems).values({ userId, productId }).onConflictDoNothing();
  }
  async removeWishlist(userId: string, productId: string) {
    await this.db.delete(wishlistItems).where(and(eq(wishlistItems.userId, userId), eq(wishlistItems.productId, productId)));
  }
  async anonymise(userId: string, oldEmail: string, anonEmail: string, at: Date) {
    await this.db.transaction(async (tx) => {
      await tx.delete(addresses).where(eq(addresses.userId, userId));
      await tx.delete(wishlistItems).where(eq(wishlistItems.userId, userId));
      await tx.update(refreshTokens).set({ revokedAt: at }).where(eq(refreshTokens.userId, userId));
      await tx.delete(newsletterSubscribers).where(eq(newsletterSubscribers.email, oldEmail));
      await tx.update(carts).set({ userId: null }).where(eq(carts.userId, userId));
      await tx.update(orders).set({ email: anonEmail, phone: '', address: null }).where(eq(orders.userId, userId));
      await tx
        .update(users)
        .set({
          email: anonEmail,
          firstName: 'Deleted',
          lastName: 'Customer',
          phone: null,
          marketingConsent: false,
          passwordHash: '!',
          totpSecret: null,
          deletedAt: at,
        })
        .where(eq(users.id, userId));
    });
  }
}
