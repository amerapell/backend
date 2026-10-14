import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { DRIZZLE, Database, DbExecutor } from '../db/database.module';
import { creditLedger } from '../db/schema';
import type { CreditLedgerRow } from '../db/schema';

export const CREDIT_REPOSITORY = Symbol('CREDIT_REPOSITORY');

export interface NewCreditEntry {
  email: string;
  userId?: string | null;
  amountKobo: number;
  reason: string;
  orderId?: string | null;
  exchangeId?: string | null;
  expiresAt?: Date | null;
}

export interface CreditRepository {
  entriesFor(email: string): Promise<CreditLedgerRow[]>;
  entriesForOrder(orderId: string): Promise<CreditLedgerRow[]>;
  add(entry: NewCreditEntry): Promise<CreditLedgerRow>;
  reassignEmail(fromEmail: string, toEmail: string): Promise<void>;
}

export async function lockCreditAccount(tx: DbExecutor, email: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'credit:' + email}))`);
}

@Injectable()
export class DrizzleCreditRepository implements CreditRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  entriesFor(email: string): Promise<CreditLedgerRow[]> {
    return this.db.select().from(creditLedger).where(eq(creditLedger.email, email.toLowerCase())).orderBy(asc(creditLedger.createdAt));
  }

  entriesForOrder(orderId: string): Promise<CreditLedgerRow[]> {
    return this.db.select().from(creditLedger).where(and(eq(creditLedger.orderId, orderId))).orderBy(asc(creditLedger.createdAt));
  }

  async add(entry: NewCreditEntry): Promise<CreditLedgerRow> {
    const [row] = await this.db
      .insert(creditLedger)
      .values({ ...entry, email: entry.email.toLowerCase() })
      .returning();
    return row;
  }

  async reassignEmail(fromEmail: string, toEmail: string): Promise<void> {
    await this.db.update(creditLedger).set({ email: toEmail.toLowerCase() }).where(eq(creditLedger.email, fromEmail.toLowerCase()));
  }
}
