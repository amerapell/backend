import { Inject, Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { DRIZZLE, Database } from '../../db/database.module';
import { discounts } from '../../db/schema';
import type { DiscountRow } from '../../db/schema';

export const DISCOUNTS_REPOSITORY = Symbol('DISCOUNTS_REPOSITORY');
export type DiscountInput = Omit<DiscountRow, 'id' | 'createdAt' | 'updatedAt' | 'usedCount'>;

export interface DiscountsRepository {
  list(): Promise<DiscountRow[]>;
  find(id: string): Promise<DiscountRow | null>;
  findByCode(code: string): Promise<DiscountRow | null>;
  create(d: DiscountInput): Promise<DiscountRow>;
  update(id: string, d: Partial<DiscountInput>): Promise<DiscountRow | null>;
  delete(id: string): Promise<boolean>;
}

@Injectable()
export class DrizzleDiscountsRepository implements DiscountsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}
  list() {
    return this.db.select().from(discounts).orderBy(desc(discounts.createdAt));
  }
  async find(id: string) {
    const [r] = await this.db.select().from(discounts).where(eq(discounts.id, id)).limit(1);
    return r ?? null;
  }
  async findByCode(code: string) {
    const [r] = await this.db.select().from(discounts).where(eq(discounts.code, code)).limit(1);
    return r ?? null;
  }
  async create(d: DiscountInput) {
    const [r] = await this.db.insert(discounts).values(d).returning();
    return r;
  }
  async update(id: string, d: Partial<DiscountInput>) {
    const [r] = await this.db.update(discounts).set(d).where(eq(discounts.id, id)).returning();
    return r ?? null;
  }
  async delete(id: string) {
    const r = await this.db.delete(discounts).where(eq(discounts.id, id)).returning({ id: discounts.id });
    return r.length > 0;
  }
}
