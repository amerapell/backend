import type { DropSettings, StoreSettings } from '../common/contract';

/** What is persisted: firstRunLeft is computed live from stock, never stored. */
export type StoredSettings = Omit<StoreSettings, 'drop'> & { drop: Omit<DropSettings, 'firstRunLeft'> | null };

export const DEFAULT_SETTINGS: StoredSettings = {
  storeName: 'Amerapelle',
  pickupAddress: '[Store address], Victoria Island, Lagos',
  openingHours: 'Mon–Sat 10:00–19:00 · Sun 12:00–17:00',
  whatsappNumber: '+2348000000000',
  instagramUrl: 'https://instagram.com/amerapelle',
  tiktokUrl: 'https://tiktok.com/@amerapelle',
  contactEmail: 'hello@amerapelle.com',
  contactPhone: '+2348000000000',
  paystackEnabled: true,
  bachsEnabled: true,
  exchangeWindowDays: 7,
  creditExpiryDays: null,
  freeDeliveryThresholdKobo: 30000000,
  // Design v3 §3: one sentence-case line in the promo bar (only the first message is shown).
  tickerText: ['Discover Drop 04 — The Night Edit', 'Delivery across Nigeria', 'Exchange, never a refund'],
  serviceImages: { stylist: null, store: null, exchange: null },
  drop: null,
};

export const SETTINGS_REPOSITORY = Symbol('SETTINGS_REPOSITORY');

export interface SettingsRepository {
  load(): Promise<Partial<StoredSettings> | null>;
  save(settings: StoredSettings): Promise<void>;
  /** Sum of available units across live variants of products in a collection (drop "N of M left"). */
  availableInCollection(collectionSlug: string): Promise<number>;
}
