import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { addMinutes, CLOCK, Clock } from '../common/clock';
import { randomToken, sha256 } from '../common/ids';
import type { UserRow } from '../db/schema';
import { NotificationsService } from '../email/notifications.service';
import { ORDERS_REPOSITORY, OrdersRepository } from '../orders/orders.repository';
import { USERS_REPOSITORY, UsersRepository } from './users.repository';

export const VERIFICATION_TTL_MINUTES = 24 * 60;
/** Minimum gap between two confirmation emails for the same account (the HTTP throttle is per IP). */
export const RESEND_COOLDOWN_MS = 60_000;
export const INVALID_VERIFICATION_LINK = 'This link is invalid or has expired';

/**
 * Proves a customer owns their email address. Exchange credit and guest orders are keyed by email, so until
 * this succeeds the account sees only what it created itself.
 */
@Injectable()
export class EmailVerificationService {
  constructor(
    @Inject(USERS_REPOSITORY) private readonly users: UsersRepository,
    @Inject(ORDERS_REPOSITORY) private readonly orders: Pick<OrdersRepository, 'claimGuestOrders'>,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly notifications: NotificationsService,
  ) {}

  /** Issues a fresh 24 h link (only the sha256 is stored) and emails it. */
  async send(user: Pick<UserRow, 'id' | 'email' | 'firstName'>): Promise<void> {
    const token = randomToken(32);
    await this.users.saveVerificationToken(user.id, sha256(token), addMinutes(this.clock.now(), VERIFICATION_TTL_MINUTES));
    await this.notifications.verifyEmail(user.email, user.firstName, token);
  }

  /** No-op when already verified, deleted, or a link was sent less than a minute ago. Returns whether an email went out. */
  async resend(userId: string): Promise<boolean> {
    const user = await this.users.findById(userId);
    if (!user || user.deletedAt || user.emailVerifiedAt) return false;
    const last = await this.users.latestVerificationTokenAt(userId);
    if (last && this.clock.now().getTime() - last.getTime() < RESEND_COOLDOWN_MS) return false;
    await this.send(user);
    return true;
  }

  /**
   * Consumes the link and marks the account verified. Clicking the same link again after it worked returns the
   * (already verified) user instead of an error; unknown/expired links → 400.
   */
  async verify(token: string): Promise<UserRow> {
    const hash = sha256(token);
    const userId = await this.users.consumeVerificationToken(hash, this.clock.now());
    if (!userId) {
      const used = await this.users.findVerificationToken(hash);
      const owner = used?.usedAt ? await this.users.findById(used.userId) : null;
      if (owner && !owner.deletedAt && owner.emailVerifiedAt) return owner;
      throw new BadRequestException(INVALID_VERIFICATION_LINK);
    }
    const user = await this.users.findById(userId);
    if (!user || user.deletedAt) throw new BadRequestException(INVALID_VERIFICATION_LINK);
    return this.markVerified(user);
  }

  /** Sets emailVerifiedAt (if not yet set) and attaches guest orders placed with this email to the account. */
  async markVerified(user: UserRow, extra: Partial<Pick<UserRow, 'googleSub' | 'passwordHash'>> = {}): Promise<UserRow> {
    const wasVerified = !!user.emailVerifiedAt;
    const patch = { ...extra, ...(wasVerified ? {} : { emailVerifiedAt: this.clock.now() }) };
    const updated = Object.keys(patch).length ? ((await this.users.update(user.id, patch)) ?? { ...user, ...patch }) : user;
    if (!wasVerified && updated.role === 'CUSTOMER') await this.orders.claimGuestOrders(updated.id, updated.email);
    return updated;
  }
}
