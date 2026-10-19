import type { DropSettings, StoreSettings } from '../common/contract';

/** What is persisted: firstRunLeft is computed live from stock, never stored. */
export type StoredSettings = Omit<StoreSettings, 'drop'> & { drop: Omit<DropSettings, 'firstRunLeft'> | null };

export const DEFAULT_SETTINGS: StoredSettings = {
  storeName: 'Amerapelle',
  pickupAddress: 'Shop N01, Novare Mall, Sangotedo, Lagos',
  openingHours: 'Mon–Sat 9am–9pm · Sun 12pm–9pm',
  whatsappNumber: '+2349046762972',
  instagramUrl: 'https://instagram.com/amerapelle',
  tiktokUrl: 'https://tiktok.com/@amerapelle',
  contactEmail: 'hello@amerapelle.com',
  contactPhone: '+234 904 676 2972',
  paystackEnabled: true,
  bachsEnabled: true,
  exchangeWindowDays: 7,
  creditExpiryDays: null,
  freeDeliveryThresholdKobo: 30000000,
  // Design v3 §3: one sentence-case line in the promo bar (only the first message is shown).
  tickerText: ['Discover Drop 04 — The Night Edit', 'Delivery across Nigeria', 'Exchange, never a refund'],
  serviceImages: { stylist: null, store: null, exchange: null },
  welcomePopup: {
    enabled: true,
    title: 'Welcome to Amerapelle',
    text: "Let's keep in touch. Be the first to discover new pieces and hear about private events at our Lagos store.",
    imageUrl: null,
  },
  homeMedia: {
    hero: { images: [], title: 'Where Fashion Meets Distinction', linkLabel: 'Discover the collection', href: '/c/new-in' },
    slides: { images: [], title: 'A World of Style', linkLabel: 'Shop New In', href: '/c/new-in' },
    still: { images: [], title: 'The Art of Curation', linkLabel: 'Read our story', href: '/about' },
  },
  drop: null,
};

export const SETTINGS_REPOSITORY = Symbol('SETTINGS_REPOSITORY');

export interface SettingsRepository {
  load(): Promise<Partial<StoredSettings> | null>;
  save(settings: StoredSettings): Promise<void>;
  /** Sum of available units across live variants of products in a collection (drop "N of M left"). */
  availableInCollection(collectionSlug: string): Promise<number>;
}
