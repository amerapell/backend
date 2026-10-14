import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CLOCK, Clock } from '../common/clock';
import type { Cart, CartLine } from '../common/contract';
import { randomToken } from '../common/ids';
import { SettingsService } from '../settings/settings.service';
import { INVENTORY_REPOSITORY, InventoryRepository, isPurchasable, VariantSnapshot } from '../catalogue/inventory.repository';
import { CART_REPOSITORY, CartLineRecord, CartRecord, CartRepository, Utm } from './cart.repository';
import { cartTotals, evaluatePromo, lineProblem, MAX_LINE_QUANTITY, PromoEvaluation, PromoRule } from './cart-math';

export interface CartIdentity {
  token?: string | null;
  userId?: string | null;
}

/** Fully priced cart used by checkout. */
export interface PricedCart {
  cart: CartRecord;
  lines: CartLine[];
  snapshots: Map<string, VariantSnapshot>;
  subtotalKobo: number;
  itemCount: number;
  promo: PromoRule | null;
  promoResult: PromoEvaluation | null;
}

@Injectable()
export class CartService {
  constructor(
    @Inject(CART_REPOSITORY) private readonly repo: CartRepository,
    @Inject(INVENTORY_REPOSITORY) private readonly inventory: InventoryRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly settings: SettingsService,
  ) {}

  /* ------------------------------------------------------------ identity */

  async create(identity: CartIdentity, utm?: Utm): Promise<Cart> {
    if (identity.userId) {
      const existing = await this.repo.findByUserId(identity.userId);
      if (existing) {
        if (utm?.source && !existing.utmSource) {
          await this.repo.update(existing.id, { utmSource: utm.source, utmMedium: utm.medium ?? null, utmCampaign: utm.campaign ?? null });
        }
        return this.view(existing.id);
      }
    }
    const cart = await this.repo.create({ token: randomToken(24), userId: identity.userId ?? null, utm });
    return this.view(cart.id);
  }

  /** Logged-in users use their own cart (adopting an unowned guest cart if they have none); guests use X-Cart-Token. */
  async resolve(identity: CartIdentity, opts: { create?: boolean } = {}): Promise<CartRecord> {
    if (identity.userId) {
      const own = await this.repo.findByUserId(identity.userId);
      if (own) return own;
      if (identity.token) {
        const guest = await this.repo.findByToken(identity.token);
        if (guest && !guest.userId && !guest.mergedIntoId) {
          await this.repo.update(guest.id, { userId: identity.userId });
          return { ...guest, userId: identity.userId };
        }
      }
      if (opts.create) return this.repo.create({ token: randomToken(24), userId: identity.userId });
      throw new NotFoundException('Cart not found');
    }
    if (identity.token) {
      const cart = await this.repo.findByToken(identity.token);
      if (cart && cart.mergedIntoId) throw new NotFoundException('Cart not found');
      if (cart && !cart.userId) return cart;
    }
    if (opts.create) return this.repo.create({ token: randomToken(24) });
    throw new NotFoundException('Cart not found');
  }

  /* ------------------------------------------------------------ queries */

  async price(cartId: string): Promise<PricedCart> {
    const cart = await this.repo.findById(cartId);
    if (!cart) throw new NotFoundException('Cart not found');
    const rows = await this.repo.lines(cart.id);
    const now = this.clock.now();
    const snaps = await this.inventory.getSnapshots(
      rows.map((r) => r.variantId),
      now,
    );
    const snapshots = new Map(snaps.map((s) => [s.variantId, s]));
    const lines = rows.filter((r) => snapshots.has(r.variantId)).map((r) => toCartLine(r, snapshots.get(r.variantId) as VariantSnapshot));
    const { subtotalKobo, itemCount } = cartTotals(lines);
    const promo = cart.promoCode ? await this.repo.findPromo(cart.promoCode) : null;
    const promoResult = cart.promoCode ? evaluatePromo(promo, subtotalKobo, now) : null;
    return { cart, lines, snapshots, subtotalKobo, itemCount, promo, promoResult };
  }

  async view(cartId: string): Promise<Cart> {
    const priced = await this.price(cartId);
    const settings = await this.settings.get();
    return {
      id: priced.cart.id,
      token: priced.cart.token,
      lines: priced.lines,
      itemCount: priced.itemCount,
      subtotalKobo: priced.subtotalKobo,
      discountKobo: priced.promoResult?.valid ? priced.promoResult.discountKobo : 0,
      promoCode: priced.cart.promoCode,
      freeDeliveryThresholdKobo: settings.freeDeliveryThresholdKobo,
    };
  }

  /* ------------------------------------------------------------ mutations */

  private async purchasableSnapshot(variantId: string): Promise<VariantSnapshot> {
    const [snap] = await this.inventory.getSnapshots([variantId], this.clock.now());
    if (!snap || !isPurchasable(snap)) throw new NotFoundException('This item is not available');
    return snap;
  }

  async addLine(cart: CartRecord, variantId: string, quantity: number): Promise<Cart> {
    const snap = await this.purchasableSnapshot(variantId);
    const existing = (await this.repo.lines(cart.id)).find((l) => l.variantId === variantId);
    const desired = (existing?.quantity ?? 0) + quantity;
    const capped = Math.min(desired, snap.available, MAX_LINE_QUANTITY);
    if (capped <= 0) throw new ConflictException('This size is sold out');
    if (existing) await this.repo.updateLine(existing.id, { quantity: capped });
    else await this.repo.insertLine(cart.id, variantId, capped);
    await this.repo.update(cart.id, {});
    return this.view(cart.id);
  }

  async updateLine(cart: CartRecord, lineId: string, patch: { quantity?: number; variantId?: string }): Promise<Cart> {
    const lines = await this.repo.lines(cart.id);
    const line = lines.find((l) => l.id === lineId);
    if (!line) throw new NotFoundException('Line not found');
    if (patch.quantity === 0) {
      await this.repo.deleteLine(line.id);
      return this.view(cart.id);
    }
    const variantId = patch.variantId ?? line.variantId;
    const now = this.clock.now();
    const [current] = await this.inventory.getSnapshots([line.variantId], now);
    const target = variantId === line.variantId ? current : await this.purchasableSnapshot(variantId);
    if (!target) throw new NotFoundException('This item is not available');
    if (current && target.productId !== current.productId) {
      throw new BadRequestException('You can only switch to another size or colour of the same piece');
    }
    let quantity = patch.quantity ?? line.quantity;
    const other = lines.find((l) => l.id !== line.id && l.variantId === variantId);
    if (other) quantity += other.quantity;
    const available = isPurchasable(target) ? target.available : 0;
    quantity = Math.min(quantity, MAX_LINE_QUANTITY, available);
    if (quantity <= 0) throw new ConflictException('This size is sold out');
    if (other) await this.repo.deleteLine(other.id);
    await this.repo.updateLine(line.id, { variantId, quantity });
    return this.view(cart.id);
  }

  async removeLine(cart: CartRecord, lineId: string): Promise<Cart> {
    const line = (await this.repo.lines(cart.id)).find((l) => l.id === lineId);
    if (!line) throw new NotFoundException('Line not found');
    await this.repo.deleteLine(line.id);
    return this.view(cart.id);
  }

  async applyPromo(cart: CartRecord, code: string): Promise<Cart> {
    const normalised = code.trim().toUpperCase();
    const priced = await this.price(cart.id);
    const rule = await this.repo.findPromo(normalised);
    const result = evaluatePromo(rule, priced.subtotalKobo, this.clock.now());
    if (!result.valid) throw new BadRequestException(result.reason);
    await this.repo.update(cart.id, { promoCode: normalised });
    return this.view(cart.id);
  }

  async removePromo(cart: CartRecord): Promise<Cart> {
    await this.repo.update(cart.id, { promoCode: null });
    return this.view(cart.id);
  }

  /** CRT-3: merge a guest cart into the user's cart after login. */
  async merge(userId: string, guestToken: string): Promise<Cart> {
    const guest = await this.repo.findByToken(guestToken);
    const own = await this.repo.findByUserId(userId);
    if (!guest || guest.mergedIntoId || (guest.userId && guest.userId !== userId)) {
      if (own) return this.view(own.id);
      return this.create({ userId });
    }
    if (!own || own.id === guest.id) {
      await this.repo.update(guest.id, { userId });
      return this.view(guest.id);
    }
    const [guestLines, ownLines] = await Promise.all([this.repo.lines(guest.id), this.repo.lines(own.id)]);
    const snaps = new Map(
      (await this.inventory.getSnapshots([...new Set(guestLines.map((l) => l.variantId))], this.clock.now())).map((s) => [s.variantId, s]),
    );
    for (const gl of guestLines) {
      const snap = snaps.get(gl.variantId);
      if (!snap || !isPurchasable(snap)) continue;
      const mine = ownLines.find((l) => l.variantId === gl.variantId);
      const qty = Math.min((mine?.quantity ?? 0) + gl.quantity, MAX_LINE_QUANTITY, Math.max(snap.available, mine?.quantity ?? 0));
      if (qty <= 0) continue;
      if (mine) await this.repo.updateLine(mine.id, { quantity: qty });
      else await this.repo.insertLine(own.id, gl.variantId, qty);
    }
    await this.repo.update(own.id, {
      promoCode: own.promoCode ?? guest.promoCode,
      utmSource: own.utmSource ?? guest.utmSource,
      utmMedium: own.utmMedium ?? guest.utmMedium,
      utmCampaign: own.utmCampaign ?? guest.utmCampaign,
    });
    await this.repo.clearLines(guest.id);
    await this.repo.update(guest.id, { mergedIntoId: own.id });
    return this.view(own.id);
  }

  /** After an order is paid: remove the purchased variants from the cart it came from (and the used promo). */
  async removePurchased(cartId: string, variantIds: string[]): Promise<void> {
    const cart = await this.repo.findById(cartId);
    if (!cart) return;
    const bought = new Set(variantIds);
    for (const line of await this.repo.lines(cartId)) {
      if (bought.has(line.variantId)) await this.repo.deleteLine(line.id);
    }
    await this.repo.update(cartId, { promoCode: null });
  }
}

export function toCartLine(line: CartLineRecord, snap: VariantSnapshot): CartLine {
  const available = isPurchasable(snap) ? snap.available : 0;
  return {
    id: line.id,
    variantId: line.variantId,
    productSlug: snap.productSlug,
    number: snap.number,
    name: snap.productName,
    colour: snap.colour,
    size: snap.size,
    material: snap.material,
    imageUrl: snap.imageUrl,
    unitKobo: snap.priceKobo,
    quantity: line.quantity,
    lineKobo: snap.priceKobo * line.quantity,
    available,
    problem: lineProblem(line.quantity, available),
  };
}
