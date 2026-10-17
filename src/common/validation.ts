import type { IsUrl } from 'class-validator';

/**
 * @IsUrl options for image URLs we store (product images, exchange photos). They come from our own uploaders:
 * Cloudinary (`https://res.cloudinary.com/…`) or the built-in media store (`${PUBLIC_API_URL}/api/v1/media/:id`).
 * PUBLIC_API_URL can be a host without a TLD (`http://localhost:4000` in development, a private hostname when
 * self-hosted), so a TLD must not be required — otherwise the API rejects image URLs it generated itself.
 */
export const IMAGE_URL_OPTIONS: Parameters<typeof IsUrl>[0] = { protocols: ['https', 'http'], require_protocol: true, require_tld: false };
