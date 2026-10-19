/**
 * API contract shapes (docs/api-contract.md). Field names here are the wire format — do not rename.
 */
export type Money = number;

export type Badge = 'NEW' | 'SALE' | 'DROP' | 'LOW_STOCK' | 'SOLD_OUT';
export type SizeGuide = 'CLOTHING' | 'SHOES' | 'NONE';
export type ZoneCode = 'LAGOS_ISLAND' | 'LAGOS_MAINLAND' | 'LEKKI_AJAH' | 'OTHER_STATES' | 'PICKUP';
export const ZONE_CODES: ZoneCode[] = ['LAGOS_ISLAND', 'LAGOS_MAINLAND', 'LEKKI_AJAH', 'OTHER_STATES', 'PICKUP'];

export type OrderStatus =
  | 'PENDING_PAYMENT'
  | 'PAID'
  | 'PROCESSING'
  | 'READY_FOR_PICKUP'
  | 'DISPATCHED'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'EXCHANGE_REQUESTED'
  | 'EXCHANGED';
export const ORDER_STATUSES: OrderStatus[] = [
  'PENDING_PAYMENT',
  'PAID',
  'PROCESSING',
  'READY_FOR_PICKUP',
  'DISPATCHED',
  'DELIVERED',
  'CANCELLED',
  'EXCHANGE_REQUESTED',
  'EXCHANGED',
];

export type ExchangeStatus = 'REQUESTED' | 'APPROVED' | 'ITEM_RECEIVED' | 'CREDIT_ISSUED' | 'COMPLETED' | 'DECLINED';
export const EXCHANGE_STATUSES: ExchangeStatus[] = ['REQUESTED', 'APPROVED', 'ITEM_RECEIVED', 'CREDIT_ISSUED', 'COMPLETED', 'DECLINED'];

export type ProviderCode = 'PAYSTACK' | 'BACHS';
export type PaymentProviderName = ProviderCode | 'CREDIT';
export type PaymentStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'EXPIRED';
export type DiscountType = 'PERCENT' | 'FIXED' | 'FREE_DELIVERY';
export type ProductStatus = 'DRAFT' | 'LIVE' | 'ARCHIVED';

export interface Colour {
  name: string;
  hex: string;
}

export interface ProductCard {
  id: string;
  slug: string;
  number: string;
  name: string;
  material: string | null;
  priceKobo: Money;
  compareAtKobo: Money | null;
  badge: Badge | null;
  lowStockCount: number | null;
  images: { url: string; alt: string }[];
  colours: Colour[];
  inStock: boolean;
  /** Admin flag: shown as the wide featured piece in listing grids. */
  featured: boolean;
}

export interface Variant {
  id: string;
  sku: string;
  colour: string | null;
  colourHex: string | null;
  size: string | null;
  priceKobo: Money;
  compareAtKobo: Money | null;
  stock: number;
  available: number;
  imageUrls: string[];
}

export interface Product extends ProductCard {
  description: string;
  details: string | null;
  care: string | null;
  sizeGuide: SizeGuide;
  exchangeable: boolean;
  options: { colours: Colour[]; sizes: string[] };
  variants: Variant[];
  collections: { slug: string; name: string }[];
  related: ProductCard[];
  seo: { title: string; description: string; ogImage: string | null };
}

export interface Collection {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  count: number;
  isDrop: boolean;
  goLiveAt: string | null;
  heroPattern: 'ADIRE' | 'ASOOKE' | null;
  heroImageUrl: string | null;
  homeOrder: number | null;
  tagline: string | null;
}

export interface CartLine {
  id: string;
  variantId: string;
  productSlug: string;
  number: string;
  name: string;
  colour: string | null;
  size: string | null;
  material: string | null;
  imageUrl: string | null;
  unitKobo: Money;
  quantity: number;
  lineKobo: Money;
  available: number;
  problem: 'SOLD_OUT' | 'LOW_STOCK' | null;
}

export interface Cart {
  id: string;
  token: string;
  lines: CartLine[];
  itemCount: number;
  subtotalKobo: Money;
  discountKobo: Money;
  promoCode: string | null;
  freeDeliveryThresholdKobo: Money | null;
}

export interface DeliveryZone {
  id: string;
  code: ZoneCode;
  name: string;
  etaText: string;
  feeKobo: Money;
  active: boolean;
}

export interface Address {
  id?: string;
  fullName: string;
  phone: string;
  state: string;
  lga: string;
  area: string;
  street: string;
  landmark: string;
  note?: string | null;
}

export interface OrderItem {
  id: string;
  name: string;
  number: string;
  colour: string | null;
  size: string | null;
  unitKobo: Money;
  quantity: number;
  imageUrl: string | null;
  exchangeable: boolean;
}

export interface Order {
  id: string;
  number: string;
  status: OrderStatus;
  email: string;
  phone: string;
  items: OrderItem[];
  delivery: { zone: ZoneCode; name: string; feeKobo: Money; address: Address | null };
  subtotalKobo: Money;
  discountKobo: Money;
  creditAppliedKobo: Money;
  deliveryKobo: Money;
  totalKobo: Money;
  amountDueKobo: Money;
  payment: { provider: PaymentProviderName | null; reference: string | null; status: PaymentStatus } | null;
  createdAt: string;
  paidAt: string | null;
  deliveredAt: string | null;
  exchangeableUntil: string | null;
}

export interface Exchange {
  id: string;
  number: string;
  orderNumber: string;
  status: ExchangeStatus;
  reason: string;
  note: string | null;
  photoUrls: string[];
  items: { orderItemId: string; name: string; quantity: number; valueKobo: Money }[];
  creditKobo: Money;
  history: { status: ExchangeStatus; at: string; note: string | null }[];
  createdAt: string;
}

/** Admin list row: the exchange plus the customer email it belongs to. */
export interface AdminExchange extends Exchange {
  email: string;
}

/** GET /admin/exchanges/:id — everything the admin detail page needs in one call. */
export interface AdminExchangeDetail extends AdminExchange {
  orderId: string;
  orderStatus: OrderStatus;
  customer: { name: string | null; email: string; phone: string | null; userId: string | null };
  items: {
    orderItemId: string;
    name: string;
    quantity: number;
    valueKobo: Money;
    number: string | null;
    sku: string | null;
    colour: string | null;
    size: string | null;
    imageUrl: string | null;
    paidUnitKobo: Money | null;
  }[];
  deliveredAt: string | null;
  exchangeWindowDays: number;
  /** deliveredAt + exchangeWindowDays (null if the order has no delivery date). */
  exchangeableUntil: string | null;
  /** Whether the request was made inside the window. */
  requestedWithinWindow: boolean;
  updatedAt: string;
}

export interface DropSettings {
  title: string;
  collectionSlug: string;
  goLiveAt: string | null;
  firstRunTotal: number;
  firstRunLeft: number;
}

export interface StoreSettings {
  storeName: string;
  pickupAddress: string;
  openingHours: string;
  whatsappNumber: string;
  instagramUrl: string;
  tiktokUrl: string;
  contactEmail: string;
  contactPhone: string;
  paystackEnabled: boolean;
  bachsEnabled: boolean;
  exchangeWindowDays: number;
  creditExpiryDays: number | null;
  freeDeliveryThresholdKobo: Money | null;
  tickerText: string[];
  /** Home "Amerapelle at your service" card photos; null → plain ground with the icon. */
  serviceImages: ServiceImages;
  /** First-visit "Welcome to Amerapelle" newsletter pop-up. */
  welcomePopup: WelcomePopup;
  /** Home page photo panels: opening image (slow zoom), slideshow, still image. */
  homeMedia: HomeMedia;
  drop: DropSettings | null;
}

/** focus = which part of a wide photo stays in view on a narrow phone screen. */
export type HomeImageFocus = 'left' | 'center' | 'right';
export interface HomeImage {
  url: string;
  focus: HomeImageFocus;
}
export interface HomePanel {
  images: HomeImage[];
  title: string;
  linkLabel: string;
  href: string;
}
export interface HomeMedia {
  hero: HomePanel;
  slides: HomePanel;
  still: HomePanel;
}

export interface ServiceImages {
  stylist: string | null;
  store: string | null;
  exchange: string | null;
}

export interface Quote {
  subtotalKobo: Money;
  discountKobo: Money;
  deliveryKobo: Money;
  creditAvailableKobo: Money;
  creditAppliedKobo: Money;
  totalKobo: Money;
  amountDueKobo: Money;
  problems: CartLine[];
}

export interface WelcomePopup {
  enabled: boolean;
  title: string;
  text: string;
  imageUrl: string | null;
}
