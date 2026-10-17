import { Logger } from '@nestjs/common';
import type { ImageUploader } from './storage.types';

/** Cloudinary wins when it is fully configured; otherwise fall back to the built-in database storage. */
export function selectImageUploader(cloudinary: ImageUploader, builtIn: ImageUploader, logger?: Pick<Logger, 'log'>): ImageUploader {
  const chosen = cloudinary.isConfigured() ? cloudinary : builtIn;
  logger?.log(chosen === cloudinary ? 'Image uploads → Cloudinary' : 'Image uploads → built-in storage (Postgres, WebP variants)');
  return chosen;
}
