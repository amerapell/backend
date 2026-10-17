import { Inject, Injectable } from '@nestjs/common';
import type { StoreSettings } from '../common/contract';
import { DEFAULT_SETTINGS, SETTINGS_REPOSITORY, SettingsRepository, StoredSettings } from './settings.types';

const CACHE_MS = 15_000;

@Injectable()
export class SettingsService {
  private cache: { value: StoredSettings; at: number } | null = null;

  constructor(@Inject(SETTINGS_REPOSITORY) private readonly repo: SettingsRepository) {}

  async get(): Promise<StoredSettings> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.value;
    const stored = await this.repo.load();
    const value: StoredSettings = { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
    this.cache = { value, at: Date.now() };
    return value;
  }

  /** Public StoreSettings (no secrets) with the live drop counter. */
  async getPublic(): Promise<StoreSettings> {
    const s = await this.get();
    const drop = s.drop
      ? { ...s.drop, firstRunLeft: Math.min(s.drop.firstRunTotal || Infinity, await this.repo.availableInCollection(s.drop.collectionSlug)) }
      : null;
    if (drop && !Number.isFinite(drop.firstRunLeft)) drop.firstRunLeft = 0;
    return { ...s, drop };
  }

  async update(patch: Partial<StoreSettings>): Promise<StoreSettings> {
    const current = await this.get();
    const next: StoredSettings = { ...current };
    for (const [k, v] of Object.entries(patch) as [keyof StoredSettings, unknown][]) {
      if (v === undefined || k === 'drop' || k === 'serviceImages') continue;
      (next as unknown as Record<string, unknown>)[k] = v;
    }
    if (patch.serviceImages) {
      const cur = next.serviceImages ?? DEFAULT_SETTINGS.serviceImages;
      next.serviceImages = {
        stylist: patch.serviceImages.stylist !== undefined ? patch.serviceImages.stylist || null : cur.stylist,
        store: patch.serviceImages.store !== undefined ? patch.serviceImages.store || null : cur.store,
        exchange: patch.serviceImages.exchange !== undefined ? patch.serviceImages.exchange || null : cur.exchange,
      };
    }
    if (patch.drop !== undefined) {
      next.drop = patch.drop
        ? {
            title: patch.drop.title,
            collectionSlug: patch.drop.collectionSlug,
            goLiveAt: patch.drop.goLiveAt ?? null,
            firstRunTotal: patch.drop.firstRunTotal ?? 0,
          }
        : null;
    }
    await this.repo.save(next);
    this.cache = null;
    return this.getPublic();
  }

  invalidate(): void {
    this.cache = null;
  }
}
