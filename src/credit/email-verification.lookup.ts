import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { DRIZZLE, Database } from '../db/database.module';
import { users } from '../db/schema';

export const EMAIL_VERIFICATION_LOOKUP = Symbol('EMAIL_VERIFICATION_LOOKUP');

/**
 * Exchange credit and guest orders/exchanges are keyed by email address. Only an account that has proved it
 * owns that address (confirmation link or Google sign-in) may see or spend them. Read from the database on
 * each use so a freshly verified account does not have to wait for a new access token.
 */
export interface EmailVerificationLookup {
  isVerified(userId: string): Promise<boolean>;
}

@Injectable()
export class DrizzleEmailVerificationLookup implements EmailVerificationLookup {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async isVerified(userId: string): Promise<boolean> {
    const [r] = await this.db
      .select({ at: users.emailVerifiedAt })
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1);
    return !!r?.at;
  }
}
