import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CLOCK, Clock } from '../common/clock';
import type { AuthUser } from '../common/auth-types';
import type { ProductCard } from '../common/contract';
import { normalizeNigerianPhone } from '../common/phone';
import { CatalogueService } from '../catalogue/catalogue.service';
import { CreditService } from '../credit/credit.service';
import { CREDIT_REPOSITORY, CreditRepository } from '../credit/credit.repository';
import { OrdersService } from '../orders/orders.service';
import { ExchangesService } from '../exchanges/exchanges.service';
import { AuthService, PublicUser } from '../auth/auth.service';
import { USERS_REPOSITORY, UsersRepository } from '../auth/users.repository';
import { CONTENT_REPOSITORY, ContentRepository } from '../content/content.repository';
import { ME_REPOSITORY, MeRepository } from './me.repository';
import { AddressesService } from './addresses.service';
import { BadRequestException } from '@nestjs/common';

@Injectable()
export class MeService {
  constructor(
    @Inject(ME_REPOSITORY) private readonly repo: MeRepository,
    @Inject(USERS_REPOSITORY) private readonly users: UsersRepository,
    @Inject(CREDIT_REPOSITORY) private readonly creditRepo: CreditRepository,
    @Inject(CONTENT_REPOSITORY) private readonly content: ContentRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly auth: AuthService,
    private readonly catalogue: CatalogueService,
    private readonly credit: CreditService,
    private readonly orders: OrdersService,
    private readonly exchanges: ExchangesService,
    private readonly addresses: AddressesService,
  ) {}

  private async user(id: string) {
    const u = await this.users.findById(id);
    if (!u || u.deletedAt) throw new NotFoundException('Account not found');
    return u;
  }

  async profile(userId: string): Promise<PublicUser> {
    return this.auth.publicUser(await this.user(userId));
  }

  async updateProfile(userId: string, patch: { firstName?: string; lastName?: string; phone?: string | null; marketingConsent?: boolean }): Promise<PublicUser> {
    const u = await this.user(userId);
    let phone = u.phone;
    if (patch.phone !== undefined) {
      phone = patch.phone ? normalizeNigerianPhone(patch.phone) : null;
      if (patch.phone && !phone) throw new BadRequestException('Enter a valid Nigerian phone number (080… or +234…)');
    }
    const updated = await this.users.update(userId, {
      firstName: patch.firstName?.trim() ?? u.firstName,
      lastName: patch.lastName?.trim() ?? u.lastName,
      phone,
      marketingConsent: patch.marketingConsent ?? u.marketingConsent,
    });
    if (patch.marketingConsent === true) await this.content.subscribe(u.email, true, 'account');
    if (patch.marketingConsent === false) await this.content.unsubscribe(u.email);
    return this.auth.publicUser(updated ?? u);
  }

  async wishlist(userId: string): Promise<ProductCard[]> {
    return this.catalogue.cardsByIds(await this.repo.wishlistProductIds(userId));
  }

  async addToWishlist(userId: string, productId: string): Promise<ProductCard[]> {
    const [card] = await this.catalogue.cardsByIds([productId]);
    if (!card) throw new NotFoundException('Product not found');
    await this.repo.addWishlist(userId, productId);
    return this.wishlist(userId);
  }

  async removeFromWishlist(userId: string, productId: string): Promise<ProductCard[]> {
    await this.repo.removeWishlist(userId, productId);
    return this.wishlist(userId);
  }

  /** NDPA 2023: everything we hold about the user, as JSON. */
  async exportData(user: AuthUser): Promise<Record<string, unknown>> {
    const u = await this.user(user.id);
    const [orders, exchanges, addresses, wishlist, credit, subscribed] = await Promise.all([
      this.orders.forUser(u.id),
      this.exchanges.forCustomer({ id: u.id, email: u.email, role: 'CUSTOMER' }),
      this.addresses.list(u.id),
      this.repo.wishlistProductIds(u.id),
      this.credit.statement(u.email),
      this.content.isSubscribed(u.email),
    ]);
    return {
      exportedAt: this.clock.now().toISOString(),
      account: {
        id: u.id,
        email: u.email,
        firstName: u.firstName,
        lastName: u.lastName,
        phone: u.phone,
        marketingConsent: u.marketingConsent,
        newsletterSubscribed: subscribed,
        createdAt: u.createdAt.toISOString(),
      },
      addresses,
      orders,
      exchanges,
      wishlistProductIds: wishlist,
      credit,
    };
  }

  /** NDPA erasure. Order financial records are retained (legal/accounting) but de-identified. Credit is forfeited. */
  async deleteAccount(userId: string): Promise<{ ok: true }> {
    const u = await this.user(userId);
    const anon = `deleted+${u.id}@anonymised.invalid`;
    await this.repo.anonymise(u.id, u.email, anon, this.clock.now());
    await this.creditRepo.reassignEmail(u.email, anon);
    return { ok: true };
  }
}
