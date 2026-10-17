import { Inject, Injectable } from '@nestjs/common';
import { AppConfig } from '../config/app-config';
import { ImageProcessor } from './image-processor';
import { MEDIA_REPOSITORY, MediaOwnerKind, MediaRepository } from './media.repository';
import type { ImageUploader, UploadedImage } from './storage.types';

/** URL path (after the origin) every built-in media URL starts with. */
export const MEDIA_PATH = '/api/v1/media/';

/** `amerapelle/exchanges` → 'exchange', anything else (products) → 'product'. */
export function ownerKindForFolder(folder: string): MediaOwnerKind {
  return /exchange/i.test(folder) ? 'exchange' : 'product';
}

/**
 * Built-in image storage (no third-party service): resizes to WebP variants and keeps them in Postgres.
 * Returned URLs are absolute and stable: `${publicApiUrl}/api/v1/media/:id` (append `?w=` for a width).
 */
@Injectable()
export class DatabaseImageStorage implements ImageUploader {
  constructor(
    private readonly config: AppConfig,
    private readonly processor: ImageProcessor,
    @Inject(MEDIA_REPOSITORY) private readonly media: MediaRepository,
  ) {}

  isConfigured(): boolean {
    return true;
  }

  async upload(file: { buffer: Buffer; mimetype: string; originalname?: string }, folder: string): Promise<UploadedImage> {
    const processed = await this.processor.process(file.buffer);
    const id = await this.media.create({
      ownerKind: ownerKindForFolder(folder),
      originalFilename: file.originalname?.slice(0, 255) || null,
      width: processed.width,
      height: processed.height,
      variants: processed.variants.map((v) => ({ width: v.width, mime: v.mime, bytes: v.bytes })),
    });
    const largest = processed.variants[processed.variants.length - 1];
    return { url: this.urlFor(id), width: largest.width, height: largest.height };
  }

  urlFor(id: string): string {
    return `${this.config.values.publicApiUrl}${MEDIA_PATH}${id}`;
  }
}
