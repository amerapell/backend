import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgSequence,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { createId } from '@paralleldrive/cuid2';

/* ------------------------------------------------------------------ enums */

export const roleEnum = pgEnum('role', ['CUSTOMER', 'ADMIN']);
export const productStatusEnum = pgEnum('product_status', ['DRAFT', 'LIVE', 'ARCHIVED']);
export const sizeGuideEnum = pgEnum('size_guide', ['CLOTHING', 'SHOES', 'NONE']);
export const heroPatternEnum = pgEnum('hero_pattern', ['ADIRE', 'ASOOKE']);
export const zoneCodeEnum = pgEnum('zone_code', ['LAGOS_ISLAND', 'LAGOS_MAINLAND', 'LEKKI_AJAH', 'OTHER_STATES', 'PICKUP']);
export const orderStatusEnum = pgEnum('order_status', [
  'PENDING_PAYMENT',
  'PAID',
  'PROCESSING',
  'READY_FOR_PICKUP',
  'DISPATCHED',
  'DELIVERED',
  'CANCELLED',
  'EXCHANGE_REQUESTED',
  'EXCHANGED',
]);
export const paymentProviderEnum = pgEnum('payment_provider', ['PAYSTACK', 'BACHS', 'CREDIT']);
export const paymentStatusEnum = pgEnum('payment_status', ['PENDING', 'SUCCEEDED', 'FAILED', 'EXPIRED']);
export const exchangeStatusEnum = pgEnum('exchange_status', [
  'REQUESTED',
  'APPROVED',
  'ITEM_RECEIVED',
  'CREDIT_ISSUED',
  'COMPLETED',
  'DECLINED',
]);
export const discountTypeEnum = pgEnum('discount_type', ['PERCENT', 'FIXED', 'FREE_DELIVERY']);

export const orderNumberSeq = pgSequence('order_number_seq', { startWith: 10501, increment: 1 });
export const exchangeNumberSeq = pgSequence('exchange_number_seq', { startWith: 2001, increment: 1 });

const id = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => createId());
const createdAt = () => timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/* ------------------------------------------------------------------ users & auth */

export const users = pgTable(
  'users',
  {
    id: id(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    firstName: text('first_name').notNull().default(''),
    lastName: text('last_name').notNull().default(''),
    phone: text('phone'),
    role: roleEnum('role').notNull().default('CUSTOMER'),
    marketingConsent: boolean('marketing_consent').notNull().default(false),
    totpSecret: text('totp_secret'),
    totpEnabled: boolean('totp_enabled').notNull().default(false),
    /** Null until the customer proves they own `email` (link in the confirmation email, or Google sign-in). */
    emailVerifiedAt: ts('email_verified_at'),
    /** Google account subject ("sub" claim) once the user has signed in with Google. */
    googleSub: text('google_sub'),
    deletedAt: ts('deleted_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('users_email_uq').on(t.email), uniqueIndex('users_google_sub_uq').on(t.googleSub)],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('refresh_tokens_hash_uq').on(t.tokenHash), index('refresh_tokens_user_idx').on(t.userId)],
);

export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: ts('expires_at').notNull(),
    usedAt: ts('used_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('password_reset_tokens_hash_uq').on(t.tokenHash)],
);

export const emailVerificationTokens = pgTable(
  'email_verification_tokens',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: ts('expires_at').notNull(),
    usedAt: ts('used_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('email_verification_tokens_hash_uq').on(t.tokenHash), index('email_verification_tokens_user_idx').on(t.userId)],
);

export const addresses = pgTable(
  'addresses',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    fullName: text('full_name').notNull(),
    phone: text('phone').notNull(),
    state: text('state').notNull(),
    lga: text('lga').notNull(),
    area: text('area').notNull(),
    street: text('street').notNull(),
    landmark: text('landmark').notNull().default(''),
    note: text('note'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('addresses_user_idx').on(t.userId)],
);

/* ------------------------------------------------------------------ catalogue */

export const collections = pgTable(
  'collections',
  {
    id: id(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    isDrop: boolean('is_drop').notNull().default(false),
    goLiveAt: ts('go_live_at'),
    heroPattern: heroPatternEnum('hero_pattern'),
    /** Design v3 §8: full-bleed photo for the home hero panel + mega menu feature. */
    heroImageUrl: text('hero_image_url'),
    /** Design v3 §8: home hero panel order (ascending); null = not on the home page. */
    homeOrder: integer('home_order'),
    /** Design v3 §8: short hero link label override ("Discover the collection"). */
    tagline: text('tagline'),
    exchangeable: boolean('exchangeable').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('collections_slug_uq').on(t.slug)],
);

export interface ProductOptions {
  colours: { name: string; hex: string }[];
  sizes: string[];
}

export const products = pgTable(
  'products',
  {
    id: id(),
    slug: text('slug').notNull(),
    number: text('number').notNull(),
    name: text('name').notNull(),
    material: text('material'),
    description: text('description').notNull().default(''),
    details: text('details'),
    care: text('care'),
    sizeGuide: sizeGuideEnum('size_guide').notNull().default('NONE'),
    exchangeable: boolean('exchangeable').notNull().default(true),
    /** Shown as the wide "featured piece" in listing grids. */
    featured: boolean('featured').notNull().default(false),
    status: productStatusEnum('status').notNull().default('DRAFT'),
    options: jsonb('options').$type<ProductOptions>().notNull().default({ colours: [], sizes: [] }),
    basePriceKobo: integer('base_price_kobo').notNull(),
    compareAtKobo: integer('compare_at_kobo'),
    lowStockThreshold: integer('low_stock_threshold').notNull().default(3),
    seoTitle: text('seo_title'),
    seoDescription: text('seo_description'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('products_slug_uq').on(t.slug), index('products_status_idx').on(t.status, t.createdAt)],
);

export const productCollections = pgTable(
  'product_collections',
  {
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    collectionId: text('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.productId, t.collectionId] }), index('product_collections_collection_idx').on(t.collectionId)],
);

export const productImages = pgTable(
  'product_images',
  {
    id: id(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    alt: text('alt').notNull().default(''),
    colour: text('colour'),
    sortOrder: integer('sort_order').notNull().default(0),
    /** How much of the frame the photo fills, in %: 100 = edge to edge (worn shots); less = a packshot sitting on the stage. */
    scale: integer('scale').notNull().default(100),
  },
  (t) => [index('product_images_product_idx').on(t.productId)],
);

export const variants = pgTable(
  'variants',
  {
    id: id(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    sku: text('sku').notNull(),
    colour: text('colour'),
    colourHex: text('colour_hex'),
    size: text('size'),
    priceKobo: integer('price_kobo').notNull(),
    compareAtKobo: integer('compare_at_kobo'),
    stock: integer('stock').notNull().default(0),
    position: integer('position').notNull().default(0),
    archived: boolean('archived').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('variants_sku_uq').on(t.sku), index('variants_product_idx').on(t.productId)],
);

export const wishlistItems = pgTable(
  'wishlist_items',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.productId] })],
);

/* ------------------------------------------------------------------ cart */

export const carts = pgTable(
  'carts',
  {
    id: id(),
    token: text('token').notNull(),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    promoCode: text('promo_code'),
    utmSource: text('utm_source'),
    utmMedium: text('utm_medium'),
    utmCampaign: text('utm_campaign'),
    mergedIntoId: text('merged_into_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('carts_token_uq').on(t.token), index('carts_user_idx').on(t.userId)],
);

export const cartLines = pgTable(
  'cart_lines',
  {
    id: id(),
    cartId: text('cart_id')
      .notNull()
      .references(() => carts.id, { onDelete: 'cascade' }),
    variantId: text('variant_id')
      .notNull()
      .references(() => variants.id, { onDelete: 'cascade' }),
    quantity: integer('quantity').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('cart_lines_cart_variant_uq').on(t.cartId, t.variantId)],
);

export const discounts = pgTable(
  'discounts',
  {
    id: id(),
    code: text('code').notNull(),
    type: discountTypeEnum('type').notNull(),
    /** PERCENT: 1–100. FIXED: kobo. FREE_DELIVERY: ignored (0). */
    value: integer('value').notNull().default(0),
    startsAt: ts('starts_at'),
    endsAt: ts('ends_at'),
    maxUses: integer('max_uses'),
    usedCount: integer('used_count').notNull().default(0),
    minSubtotalKobo: integer('min_subtotal_kobo'),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('discounts_code_uq').on(t.code)],
);

export const deliveryZones = pgTable(
  'delivery_zones',
  {
    id: id(),
    code: zoneCodeEnum('code').notNull(),
    name: text('name').notNull(),
    etaText: text('eta_text').notNull(),
    feeKobo: integer('fee_kobo').notNull(),
    active: boolean('active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('delivery_zones_code_uq').on(t.code)],
);

/* ------------------------------------------------------------------ orders & payments */

export interface AddressSnapshot {
  fullName: string;
  phone: string;
  state: string;
  lga: string;
  area: string;
  street: string;
  landmark: string;
  note?: string | null;
}

export const orders = pgTable(
  'orders',
  {
    id: id(),
    number: text('number').notNull(),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    cartId: text('cart_id'),
    email: text('email').notNull(),
    phone: text('phone').notNull(),
    status: orderStatusEnum('status').notNull().default('PENDING_PAYMENT'),
    zoneCode: zoneCodeEnum('zone_code').notNull(),
    zoneName: text('zone_name').notNull(),
    address: jsonb('address').$type<AddressSnapshot | null>(),
    subtotalKobo: integer('subtotal_kobo').notNull(),
    discountKobo: integer('discount_kobo').notNull().default(0),
    discountCode: text('discount_code'),
    deliveryKobo: integer('delivery_kobo').notNull().default(0),
    creditAppliedKobo: integer('credit_applied_kobo').notNull().default(0),
    totalKobo: integer('total_kobo').notNull(),
    amountDueKobo: integer('amount_due_kobo').notNull(),
    paymentProvider: paymentProviderEnum('payment_provider'),
    paymentReference: text('payment_reference'),
    paymentStatus: paymentStatusEnum('payment_status'),
    providerSessionId: text('provider_session_id'),
    utmSource: text('utm_source'),
    utmMedium: text('utm_medium'),
    utmCampaign: text('utm_campaign'),
    marketingConsent: boolean('marketing_consent').notNull().default(false),
    holdExpiresAt: ts('hold_expires_at'),
    paidAt: ts('paid_at'),
    deliveredAt: ts('delivered_at'),
    cancelledAt: ts('cancelled_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('orders_number_uq').on(t.number),
    uniqueIndex('orders_payment_reference_uq').on(t.paymentReference),
    index('orders_provider_session_idx').on(t.providerSessionId),
    index('orders_user_idx').on(t.userId),
    index('orders_email_idx').on(t.email),
    index('orders_status_idx').on(t.status, t.createdAt),
  ],
);

export const orderItems = pgTable(
  'order_items',
  {
    id: id(),
    orderId: text('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    productId: text('product_id').references(() => products.id, { onDelete: 'set null' }),
    variantId: text('variant_id').references(() => variants.id, { onDelete: 'set null' }),
    sku: text('sku').notNull(),
    name: text('name').notNull(),
    number: text('number').notNull(),
    colour: text('colour'),
    size: text('size'),
    material: text('material'),
    imageUrl: text('image_url'),
    unitKobo: integer('unit_kobo').notNull(),
    /** What the customer actually paid per unit after the order discount — the exchange credit value (EXC-4). */
    paidUnitKobo: integer('paid_unit_kobo').notNull(),
    quantity: integer('quantity').notNull(),
    exchangeable: boolean('exchangeable').notNull().default(true),
  },
  (t) => [index('order_items_order_idx').on(t.orderId)],
);

export const orderNotes = pgTable(
  'order_notes',
  {
    id: id(),
    orderId: text('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    author: text('author'),
    createdAt: createdAt(),
  },
  (t) => [index('order_notes_order_idx').on(t.orderId)],
);

export const stockHolds = pgTable(
  'stock_holds',
  {
    id: id(),
    variantId: text('variant_id')
      .notNull()
      .references(() => variants.id, { onDelete: 'cascade' }),
    orderId: text('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    quantity: integer('quantity').notNull(),
    expiresAt: ts('expires_at').notNull(),
    releasedAt: ts('released_at'),
    consumedAt: ts('consumed_at'),
    createdAt: createdAt(),
  },
  (t) => [index('stock_holds_variant_idx').on(t.variantId), index('stock_holds_order_idx').on(t.orderId), index('stock_holds_expiry_idx').on(t.expiresAt)],
);

export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: id(),
    provider: paymentProviderEnum('provider').notNull(),
    eventId: text('event_id').notNull(),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull(),
    processedAt: ts('processed_at'),
    error: text('error'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('webhook_events_provider_event_uq').on(t.provider, t.eventId)],
);

/* ------------------------------------------------------------------ exchanges & credit */

export const exchanges = pgTable(
  'exchanges',
  {
    id: id(),
    number: text('number').notNull(),
    orderId: text('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    email: text('email').notNull(),
    status: exchangeStatusEnum('status').notNull().default('REQUESTED'),
    reason: text('reason').notNull(),
    note: text('note'),
    photoUrls: jsonb('photo_urls').$type<string[]>().notNull().default([]),
    creditKobo: integer('credit_kobo').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('exchanges_number_uq').on(t.number), index('exchanges_order_idx').on(t.orderId), index('exchanges_status_idx').on(t.status)],
);

export const exchangeItems = pgTable(
  'exchange_items',
  {
    id: id(),
    exchangeId: text('exchange_id')
      .notNull()
      .references(() => exchanges.id, { onDelete: 'cascade' }),
    orderItemId: text('order_item_id')
      .notNull()
      .references(() => orderItems.id, { onDelete: 'cascade' }),
    quantity: integer('quantity').notNull(),
    valueKobo: integer('value_kobo').notNull(),
  },
  (t) => [index('exchange_items_exchange_idx').on(t.exchangeId)],
);

export const exchangeHistory = pgTable(
  'exchange_history',
  {
    id: id(),
    exchangeId: text('exchange_id')
      .notNull()
      .references(() => exchanges.id, { onDelete: 'cascade' }),
    status: exchangeStatusEnum('status').notNull(),
    note: text('note'),
    at: ts('at').notNull().defaultNow(),
  },
  (t) => [index('exchange_history_exchange_idx').on(t.exchangeId)],
);

/** Exchange credit ledger. Positive = issued, negative = spent. Keyed by customer email (lowercase). */
export const creditLedger = pgTable(
  'credit_ledger',
  {
    id: id(),
    email: text('email').notNull(),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    amountKobo: integer('amount_kobo').notNull(),
    reason: text('reason').notNull(),
    orderId: text('order_id').references(() => orders.id, { onDelete: 'set null' }),
    exchangeId: text('exchange_id').references(() => exchanges.id, { onDelete: 'set null' }),
    expiresAt: ts('expires_at'),
    createdAt: createdAt(),
  },
  (t) => [index('credit_ledger_email_idx').on(t.email)],
);

/* ------------------------------------------------------------------ content */

export const storeSettings = pgTable('store_settings', {
  id: text('id').primaryKey(),
  data: jsonb('data').notNull(),
  updatedAt: updatedAt(),
});

export const faqItems = pgTable('faq_items', {
  id: id(),
  group: text('group').notNull(),
  question: text('question').notNull(),
  answer: text('answer').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const pages = pgTable('pages', {
  slug: text('slug').primaryKey(),
  title: text('title').notNull(),
  bodyMarkdown: text('body_markdown').notNull(),
  updatedAt: updatedAt(),
});

export const newsletterSubscribers = pgTable(
  'newsletter_subscribers',
  {
    id: id(),
    email: text('email').notNull(),
    consent: boolean('consent').notNull(),
    source: text('source'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('newsletter_email_uq').on(t.email)],
);

export const dropNotifications = pgTable(
  'drop_notifications',
  {
    id: id(),
    contact: text('contact').notNull(),
    collectionSlug: text('collection_slug').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('drop_notifications_uq').on(t.contact, t.collectionSlug)],
);

/** "Notify me" sign-ups for a sold-out size (variant) on the product page. */
export const stockNotifications = pgTable(
  'stock_notifications',
  {
    id: id(),
    email: text('email').notNull(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    variantId: text('variant_id')
      .notNull()
      .references(() => variants.id, { onDelete: 'cascade' }),
    notifiedAt: ts('notified_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('stock_notifications_uq').on(t.email, t.variantId), index('stock_notifications_variant_idx').on(t.variantId)],
);

export const contactMessages = pgTable('contact_messages', {
  id: id(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  phone: text('phone'),
  subject: text('subject').notNull(),
  message: text('message').notNull(),
  createdAt: createdAt(),
});

/* ------------------------------------------------------------------ media (built-in image storage) */

/** Postgres `bytea` ⇄ Node Buffer. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

/** An uploaded image when Cloudinary is not configured. Bytes live in media_variants (WebP, several widths). */
export const mediaFiles = pgTable(
  'media_files',
  {
    id: id(),
    /** What the image belongs to: 'product' | 'exchange'. */
    ownerKind: text('owner_kind').notNull(),
    originalFilename: text('original_filename'),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('media_files_owner_kind_idx').on(t.ownerKind, t.createdAt)],
);

export const mediaVariants = pgTable(
  'media_variants',
  {
    mediaId: text('media_id')
      .notNull()
      .references(() => mediaFiles.id, { onDelete: 'cascade' }),
    width: integer('width').notNull(),
    mime: text('mime').notNull(),
    bytes: bytea('bytes').notNull(),
    byteSize: integer('byte_size').notNull(),
  },
  (t) => [uniqueIndex('media_variants_media_width_uq').on(t.mediaId, t.width)],
);

/* ------------------------------------------------------------------ inferred row types */

export type UserRow = typeof users.$inferSelect;
export type CollectionRow = typeof collections.$inferSelect;
export type ProductRow = typeof products.$inferSelect;
export type ProductImageRow = typeof productImages.$inferSelect;
export type VariantRow = typeof variants.$inferSelect;
export type CartRow = typeof carts.$inferSelect;
export type CartLineRow = typeof cartLines.$inferSelect;
export type DiscountRow = typeof discounts.$inferSelect;
export type DeliveryZoneRow = typeof deliveryZones.$inferSelect;
export type OrderRow = typeof orders.$inferSelect;
export type OrderItemRow = typeof orderItems.$inferSelect;
export type ExchangeRow = typeof exchanges.$inferSelect;
export type ExchangeItemRow = typeof exchangeItems.$inferSelect;
export type ExchangeHistoryRow = typeof exchangeHistory.$inferSelect;
export type CreditLedgerRow = typeof creditLedger.$inferSelect;
export type FaqItemRow = typeof faqItems.$inferSelect;
export type PageRow = typeof pages.$inferSelect;
export type AddressRow = typeof addresses.$inferSelect;
export type MediaFileRow = typeof mediaFiles.$inferSelect;
export type MediaVariantRow = typeof mediaVariants.$inferSelect;
