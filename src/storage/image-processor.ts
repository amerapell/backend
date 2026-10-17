import { BadRequestException, Injectable } from '@nestjs/common';
import sharp from 'sharp';

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export const MIN_IMAGE_WIDTH = 300;
/** Responsive widths stored for every image (phones ≈480–960, desktop/zoom 1600). */
export const VARIANT_WIDTHS = [480, 960, 1600] as const;
const WEBP_QUALITY = 76;
const WEBP_EFFORT = 4;
/** Guard against decompression bombs (~ 12k × 12k). */
export const MAX_INPUT_PIXELS = 150_000_000;

export interface ProcessedVariant {
  width: number;
  height: number;
  mime: 'image/webp';
  bytes: Buffer;
}

export interface ProcessedImage {
  /** Upright (EXIF-oriented) size of the original. */
  width: number;
  height: number;
  /** Ascending by width; at least one. */
  variants: ProcessedVariant[];
}

/**
 * Which widths to generate for an original of `originalWidth` px: every standard width that does not upscale,
 * plus the original width itself when it sits between two standard widths (so a 1200px photo keeps 1200, not
 * just 960). Always at least one entry.
 */
export function planVariantWidths(originalWidth: number, widths: readonly number[] = VARIANT_WIDTHS): number[] {
  const sorted = [...widths].sort((a, b) => a - b);
  const kept = sorted.filter((w) => w <= originalWidth);
  const largest = sorted[sorted.length - 1];
  if (originalWidth < largest && !kept.includes(originalWidth)) kept.push(originalWidth);
  return kept.length ? kept : [Math.min(originalWidth, largest)];
}

/** Formats we decode. AVIF is reported by libvips as `heif` + av1 compression; HEVC (iPhone HEIC) is not decodable. */
function formatAllowed(meta: sharp.Metadata): boolean {
  switch (meta.format) {
    case 'jpeg':
    case 'png':
    case 'webp':
    case 'gif':
    case 'tiff':
    case 'avif':
      return true;
    case 'heif':
      return meta.compression === 'av1';
    default:
      return false;
  }
}

/** Decodes, auto-orients, strips metadata and re-encodes an upload as WebP at responsive widths. */
@Injectable()
export class ImageProcessor {
  async process(input: Buffer): Promise<ProcessedImage> {
    if (!input?.length) throw new BadRequestException('The file is empty');
    if (input.length > MAX_UPLOAD_BYTES) throw new BadRequestException('Image is too large — the limit is 15 MB');

    let meta: sharp.Metadata;
    try {
      meta = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
    } catch {
      throw new BadRequestException('That file is not an image we can read — upload a JPEG, PNG, WebP, AVIF, GIF or TIFF');
    }
    if (meta.format === 'heif' && meta.compression !== 'av1') {
      throw new BadRequestException('HEIC photos are not supported — export the photo as JPEG and try again');
    }
    if (!formatAllowed(meta) || !meta.width || !meta.height) {
      throw new BadRequestException('Unsupported image type — upload a JPEG, PNG, WebP, AVIF, GIF or TIFF');
    }
    // EXIF orientations 5–8 rotate by 90°, swapping the upright width/height.
    const swap = (meta.orientation ?? 1) >= 5;
    const width = swap ? meta.height : meta.width;
    const height = swap ? meta.width : meta.height;
    if (width < MIN_IMAGE_WIDTH) {
      throw new BadRequestException(`Image is too small — it must be at least ${MIN_IMAGE_WIDTH}px wide (this one is ${width}px)`);
    }

    // animated:false → first frame of a GIF / animated WebP. Output never carries EXIF/ICC/XMP (no withMetadata()).
    const base = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, animated: false, failOn: 'error' }).rotate();
    const variants: ProcessedVariant[] = [];
    try {
      for (const target of planVariantWidths(width)) {
        const { data, info } = await base
          .clone()
          .resize({ width: target, withoutEnlargement: true })
          .webp({ quality: WEBP_QUALITY, effort: WEBP_EFFORT })
          .toBuffer({ resolveWithObject: true });
        variants.push({ width: info.width, height: info.height, mime: 'image/webp', bytes: data });
      }
    } catch {
      throw new BadRequestException('The image could not be processed — it may be corrupt. Try exporting it again as JPEG');
    }
    return { width, height, variants };
  }
}
