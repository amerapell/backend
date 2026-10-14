import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { DRIZZLE, Database } from '../db/database.module';
import { emailVerificationTokens, passwordResetTokens, refreshTokens, users } from '../db/schema';
import type { UserRow } from '../db/schema';

export const USERS_REPOSITORY = Symbol('USERS_REPOSITORY');

export type NewUser = Pick<UserRow, 'email' | 'passwordHash' | 'firstName' | 'lastName' | 'phone' | 'marketingConsent'> & {
  role?: UserRow['role'];
  emailVerifiedAt?: Date | null;
  googleSub?: string | null;
};

export interface UsersRepository {
  findByEmail(email: string): Promise<UserRow | null>;
  findById(id: string): Promise<UserRow | null>;
  create(user: NewUser): Promise<UserRow>;
  update(id: string, patch: Partial<Omit<UserRow, 'id' | 'createdAt'>>): Promise<UserRow | null>;
  saveRefreshToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  findActiveRefreshToken(tokenHash: string, now: Date): Promise<{ id: string; userId: string } | null>;
  revokeRefreshToken(id: string, at: Date): Promise<void>;
  revokeAllRefreshTokens(userId: string, at: Date): Promise<void>;
  saveResetToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  consumeResetToken(tokenHash: string, now: Date): Promise<string | null>;
  findByGoogleSub(sub: string): Promise<UserRow | null>;
  saveVerificationToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  /** Marks the token used and returns its user; null when unknown, already used or expired. */
  consumeVerificationToken(tokenHash: string, now: Date): Promise<string | null>;
  findVerificationToken(tokenHash: string): Promise<{ userId: string; usedAt: Date | null } | null>;
  latestVerificationTokenAt(userId: string): Promise<Date | null>;
}

@Injectable()
export class DrizzleUsersRepository implements UsersRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async findByEmail(email: string) {
    const [r] = await this.db.select().from(users).where(eq(users.email, email.trim().toLowerCase())).limit(1);
    return r ?? null;
  }
  async findById(id: string) {
    const [r] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return r ?? null;
  }
  async create(user: NewUser) {
    const [r] = await this.db
      .insert(users)
      .values({ ...user, email: user.email.trim().toLowerCase() })
      .returning();
    return r;
  }
  async update(id: string, patch: Partial<Omit<UserRow, 'id' | 'createdAt'>>) {
    const [r] = await this.db.update(users).set(patch).where(eq(users.id, id)).returning();
    return r ?? null;
  }
  async saveRefreshToken(userId: string, tokenHash: string, expiresAt: Date) {
    await this.db.insert(refreshTokens).values({ userId, tokenHash, expiresAt });
  }
  async findActiveRefreshToken(tokenHash: string, now: Date) {
    const [r] = await this.db
      .select({ id: refreshTokens.id, userId: refreshTokens.userId })
      .from(refreshTokens)
      .where(and(eq(refreshTokens.tokenHash, tokenHash), isNull(refreshTokens.revokedAt), gt(refreshTokens.expiresAt, now)))
      .limit(1);
    return r ?? null;
  }
  async revokeRefreshToken(id: string, at: Date) {
    await this.db.update(refreshTokens).set({ revokedAt: at }).where(eq(refreshTokens.id, id));
  }
  async revokeAllRefreshTokens(userId: string, at: Date) {
    await this.db.update(refreshTokens).set({ revokedAt: at }).where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
  }
  async saveResetToken(userId: string, tokenHash: string, expiresAt: Date) {
    await this.db.insert(passwordResetTokens).values({ userId, tokenHash, expiresAt });
  }
  async consumeResetToken(tokenHash: string, now: Date) {
    const [r] = await this.db
      .update(passwordResetTokens)
      .set({ usedAt: now })
      .where(and(eq(passwordResetTokens.tokenHash, tokenHash), isNull(passwordResetTokens.usedAt), gt(passwordResetTokens.expiresAt, now)))
      .returning({ userId: passwordResetTokens.userId });
    return r?.userId ?? null;
  }
  async findByGoogleSub(sub: string) {
    const [r] = await this.db.select().from(users).where(eq(users.googleSub, sub)).limit(1);
    return r ?? null;
  }
  async saveVerificationToken(userId: string, tokenHash: string, expiresAt: Date) {
    await this.db.insert(emailVerificationTokens).values({ userId, tokenHash, expiresAt });
  }
  async consumeVerificationToken(tokenHash: string, now: Date) {
    const [r] = await this.db
      .update(emailVerificationTokens)
      .set({ usedAt: now })
      .where(and(eq(emailVerificationTokens.tokenHash, tokenHash), isNull(emailVerificationTokens.usedAt), gt(emailVerificationTokens.expiresAt, now)))
      .returning({ userId: emailVerificationTokens.userId });
    return r?.userId ?? null;
  }
  async findVerificationToken(tokenHash: string) {
    const [r] = await this.db
      .select({ userId: emailVerificationTokens.userId, usedAt: emailVerificationTokens.usedAt })
      .from(emailVerificationTokens)
      .where(eq(emailVerificationTokens.tokenHash, tokenHash))
      .limit(1);
    return r ?? null;
  }
  async latestVerificationTokenAt(userId: string) {
    const [r] = await this.db
      .select({ at: emailVerificationTokens.createdAt })
      .from(emailVerificationTokens)
      .where(eq(emailVerificationTokens.userId, userId))
      .orderBy(desc(emailVerificationTokens.createdAt))
      .limit(1);
    return r?.at ?? null;
  }
}
