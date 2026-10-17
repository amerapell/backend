import { Controller, Get, Inject, NotFoundException, Param, Query, Req, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { MEDIA_REPOSITORY, MediaRepository, pickVariantWidth } from './media.repository';

const ID_RE = /^[a-z0-9]{8,40}$/;

/**
 * Public image delivery for the built-in storage: `GET /api/v1/media/:id?w=960`.
 * Variants never change once written, so responses are cacheable forever by browsers and CDNs.
 * Loaded by <img> on the storefront's own domain, hence Cross-Origin-Resource-Policy: cross-origin.
 */
@Controller('media')
@SkipThrottle()
export class MediaController {
  constructor(@Inject(MEDIA_REPOSITORY) private readonly media: MediaRepository) {}

  @Get(':id')
  async get(@Param('id') id: string, @Query('w') w: string | undefined, @Req() req: Request, @Res() res: Response): Promise<void> {
    if (!ID_RE.test(id)) throw new NotFoundException('Image not found');
    const requested = w ? Number.parseInt(w, 10) : undefined;
    const width = pickVariantWidth(await this.media.variantWidths(id), requested);
    if (width === null) throw new NotFoundException('Image not found');

    const etag = `"${id}-${width}"`;
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('ETag', etag);
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }
    const variant = await this.media.variant(id, width);
    if (!variant) throw new NotFoundException('Image not found');
    res.setHeader('Content-Type', variant.mime);
    res.setHeader('Content-Length', String(variant.bytes.length));
    res.status(200).end(variant.bytes);
  }
}
