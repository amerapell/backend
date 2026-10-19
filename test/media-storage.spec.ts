import { BadRequestException, NotFoundException } from '@nestjs/common';
import sharp from 'sharp';
import { BackgroundRemover } from '../src/storage/background-remover';
import { AdminUploadsController } from '../src/admin/products/admin-products.controller';
import { CloudinaryStorage } from '../src/storage/cloudinary.service';
import { DatabaseImageStorage, ownerKindForFolder } from '../src/storage/database-image.storage';
import { ImageProcessor, MAX_UPLOAD_BYTES, planVariantWidths } from '../src/storage/image-processor';
import { MediaController } from '../src/storage/media.controller';
import { MediaRepository, NewMedia, StoredVariant, pickVariantWidth } from '../src/storage/media.repository';
import { selectImageUploader } from '../src/storage/storage.selector';
import type { ImageUploader } from '../src/storage/storage.types';
import { testConfig } from './fakes';

function jpeg(width: number, height: number, opts: { orientation?: number } = {}): Promise<Buffer> {
  let img = sharp({ create: { width, height, channels: 3, background: { r: 10, g: 10, b: 60 } } }).jpeg({ quality: 90 });
  if (opts.orientation) img = img.withMetadata({ orientation: opts.orientation });
  return img.toBuffer();
}

class InMemoryMediaRepository implements MediaRepository {
  items = new Map<string, NewMedia>();
  private seq = 0;
  async create(media: NewMedia) {
    const id = `media${String(++this.seq).padStart(6, '0')}`;
    this.items.set(id, media);
    return id;
  }
  async variantWidths(id: string) {
    return (this.items.get(id)?.variants ?? []).map((v) => v.width).sort((a, b) => a - b);
  }
  async variant(id: string, width: number): Promise<StoredVariant | null> {
    return this.items.get(id)?.variants.find((v) => v.width === width) ?? null;
  }
  async deleteUnreferencedProductMedia() {
    return 0;
  }
}

describe('ImageProcessor', () => {
  const processor = new ImageProcessor();

  it('produces WebP variants at 480/960/1600 for a large photo, metadata stripped', async () => {
    const out = await processor.process(await jpeg(2400, 3000));
    expect(out).toMatchObject({ width: 2400, height: 3000 });
    expect(out.variants.map((v) => v.width)).toEqual([480, 960, 1600]);
    for (const v of out.variants) {
      const meta = await sharp(v.bytes).metadata();
      expect(meta.format).toBe('webp');
      expect(meta.width).toBe(v.width);
      expect(meta.exif).toBeUndefined();
      expect(v.mime).toBe('image/webp');
    }
    expect(out.variants[2].height).toBe(2000);
  });

  it('never upscales: a 700px image keeps 480 + its own width', async () => {
    const out = await processor.process(await jpeg(700, 900));
    expect(out.variants.map((v) => v.width)).toEqual([480, 700]);
  });

  it('keeps at least one variant for an image narrower than the smallest width', async () => {
    const out = await processor.process(await jpeg(320, 400));
    expect(out.variants.map((v) => v.width)).toEqual([320]);
  });

  it('auto-orients from EXIF (orientation 6 swaps width/height)', async () => {
    const out = await processor.process(await jpeg(1200, 600, { orientation: 6 }));
    expect(out).toMatchObject({ width: 600, height: 1200 });
    const largest = out.variants[out.variants.length - 1];
    expect(largest).toMatchObject({ width: 600, height: 1200 });
  });

  it('accepts PNG and takes the first frame of a GIF', async () => {
    const png = await sharp({ create: { width: 500, height: 500, channels: 4, background: '#ffffff' } }).png().toBuffer();
    const gif = await sharp({ create: { width: 500, height: 500, channels: 3, background: '#000080' } }).gif().toBuffer();
    expect((await processor.process(png)).variants[0].mime).toBe('image/webp');
    expect((await processor.process(gif)).variants.map((v) => v.width)).toEqual([480, 500]);
  });

  it('rejects non-images, tiny images and files over 15 MB with 400s', async () => {
    await expect(processor.process(Buffer.from('definitely not an image'))).rejects.toThrow(/not an image/);
    await expect(processor.process(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900"/>'))).rejects.toThrow(/Unsupported image type/);
    await expect(processor.process(await jpeg(200, 800))).rejects.toThrow(/at least 300px wide/);
    await expect(processor.process(Buffer.alloc(MAX_UPLOAD_BYTES + 1))).rejects.toThrow(/15 MB/);
    await expect(processor.process(Buffer.alloc(0))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('planVariantWidths', () => {
    expect(planVariantWidths(4000)).toEqual([480, 960, 1600]);
    expect(planVariantWidths(1600)).toEqual([480, 960, 1600]);
    expect(planVariantWidths(1200)).toEqual([480, 960, 1200]);
    expect(planVariantWidths(960)).toEqual([480, 960]);
    expect(planVariantWidths(301)).toEqual([301]);
  });
});

describe('DatabaseImageStorage', () => {
  it('stores variants and returns a stable absolute media URL', async () => {
    const repo = new InMemoryMediaRepository();
    const storage = new DatabaseImageStorage(testConfig({ PUBLIC_API_URL: 'https://api.shop.test/' }), new ImageProcessor(), repo);
    const res = await storage.upload({ buffer: await jpeg(2000, 2500), mimetype: 'image/jpeg', originalname: 'look.jpg' }, 'amerapelle/products');
    expect(res).toEqual({ url: 'https://api.shop.test/api/v1/media/media000001', width: 1600, height: 2000 });
    const stored = repo.items.get('media000001')!;
    expect(stored).toMatchObject({ ownerKind: 'product', originalFilename: 'look.jpg', width: 2000, height: 2500 });
    expect(stored.variants).toHaveLength(3);
    expect(storage.isConfigured()).toBe(true);
  });

  it('resolves the public API URL: PUBLIC_API_URL → RAILWAY_PUBLIC_DOMAIN → localhost:PORT', () => {
    expect(testConfig({ PUBLIC_API_URL: 'https://x.test/api/v1' }).values.publicApiUrl).toBe('https://x.test');
    expect(testConfig({ RAILWAY_PUBLIC_DOMAIN: 'amerapelle-api.up.railway.app' }).values.publicApiUrl).toBe('https://amerapelle-api.up.railway.app');
    expect(testConfig({ PORT: '4777' }).values.publicApiUrl).toBe('http://localhost:4777');
  });

  it('maps folders to owner kinds', () => {
    expect(ownerKindForFolder('amerapelle/exchanges')).toBe('exchange');
    expect(ownerKindForFolder('amerapelle/products')).toBe('product');
  });
});

describe('selectImageUploader', () => {
  const fake = (configured: boolean): ImageUploader => ({ isConfigured: () => configured, upload: async () => ({ url: 'x' }) });

  it('prefers Cloudinary when configured, else the built-in storage', () => {
    const cloud = fake(true);
    const builtIn = fake(true);
    expect(selectImageUploader(cloud, builtIn)).toBe(cloud);
    const unconfigured = fake(false);
    expect(selectImageUploader(unconfigured, builtIn)).toBe(builtIn);
  });
});

describe('media delivery', () => {
  it('pickVariantWidth: smallest ≥ requested, else largest', () => {
    const widths = [480, 960, 1600];
    expect(pickVariantWidth(widths, 480)).toBe(480);
    expect(pickVariantWidth(widths, 481)).toBe(960);
    expect(pickVariantWidth(widths, 2000)).toBe(1600);
    expect(pickVariantWidth(widths, 1)).toBe(480);
    expect(pickVariantWidth(widths)).toBe(1600);
    expect(pickVariantWidth(widths, Number.NaN)).toBe(1600);
    expect(pickVariantWidth([], 480)).toBeNull();
  });

  function fakeRes() {
    const headers: Record<string, string> = {};
    const res = {
      statusCode: 0,
      body: undefined as Buffer | undefined,
      setHeader: (k: string, v: string) => ((headers[k.toLowerCase()] = v), res),
      status: (c: number) => ((res.statusCode = c), res),
      end: (b?: Buffer) => ((res.body = b), res),
    };
    return { res, headers };
  }

  it('serves the right variant with immutable caching, ETag/304 and 404 for unknown ids', async () => {
    const repo = new InMemoryMediaRepository();
    const id = await repo.create({
      ownerKind: 'product',
      originalFilename: null,
      width: 2000,
      height: 2000,
      variants: [480, 960, 1600].map((w) => ({ width: w, mime: 'image/webp', bytes: Buffer.alloc(w) })),
    });
    const ctrl = new MediaController(repo);

    const a = fakeRes();
    await ctrl.get(id, '700', { headers: {} } as never, a.res as never);
    expect(a.res.statusCode).toBe(200);
    expect(a.res.body?.length).toBe(960);
    expect(a.headers['content-type']).toBe('image/webp');
    expect(a.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(a.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(a.headers.etag).toBe(`"${id}-960"`);

    const b = fakeRes();
    await ctrl.get(id, '2000', { headers: {} } as never, b.res as never);
    expect(b.res.body?.length).toBe(1600);

    const c = fakeRes();
    await ctrl.get(id, '480', { headers: { 'if-none-match': `"${id}-480"` } } as never, c.res as never);
    expect(c.res.statusCode).toBe(304);
    expect(c.res.body).toBeUndefined();

    await expect(ctrl.get('media999999', '480', { headers: {} } as never, fakeRes().res as never)).rejects.toBeInstanceOf(NotFoundException);
    await expect(ctrl.get('../etc', undefined, { headers: {} } as never, fakeRes().res as never)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('AdminUploadsController', () => {
  const uploader: ImageUploader = { isConfigured: () => true, upload: async () => ({ url: 'https://api.test/api/v1/media/abc', width: 960, height: 1200 }) };
  const noRemover = { isAvailable: () => false, cutout: async () => Buffer.alloc(0) } as unknown as BackgroundRemover;

  it('sign → { mode: direct } without Cloudinary keys, { mode: cloudinary, …signed } with them', () => {
    const none = new AdminUploadsController(new CloudinaryStorage(testConfig()), uploader, noRemover);
    expect(none.sign()).toEqual({ mode: 'direct', backgroundRemoval: false });
    const cfg = testConfig({ CLOUDINARY_CLOUD_NAME: 'demo', CLOUDINARY_API_KEY: 'k', CLOUDINARY_API_SECRET: 's' });
    const signed = new AdminUploadsController(new CloudinaryStorage(cfg), uploader, noRemover).sign();
    expect(signed).toMatchObject({ mode: 'cloudinary', cloudName: 'demo', apiKey: 'k', folder: 'amerapelle/products' });
    expect(signed.mode === 'cloudinary' && typeof signed.signature).toBe('string');
  });

  it('image → { url, width, height }; 400 without a file', async () => {
    const ctrl = new AdminUploadsController(new CloudinaryStorage(testConfig()), uploader, noRemover);
    await expect(ctrl.image({ buffer: Buffer.from('x'), mimetype: 'image/jpeg' } as Express.Multer.File)).resolves.toEqual({ url: 'https://api.test/api/v1/media/abc', width: 960, height: 1200 });
    await expect(ctrl.image(undefined)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('removeBackground=true stores the cut-out (and the original when keepOriginal=true)', async () => {
    const stored: { name?: string; mime: string }[] = [];
    let n = 0;
    const recording: ImageUploader = {
      isConfigured: () => true,
      upload: async (f) => {
        stored.push({ name: f.originalname, mime: f.mimetype });
        return { url: `https://api.test/api/v1/media/m${++n}`, width: 1600, height: 2000 };
      },
    };
    const layouts: string[] = [];
    const remover = { isAvailable: () => true, cutout: async (_b: Buffer, layout: string) => (layouts.push(layout), Buffer.from('cut')) } as unknown as BackgroundRemover;
    const ctrl = new AdminUploadsController(new CloudinaryStorage(testConfig()), recording, remover);
    expect(ctrl.sign()).toEqual({ mode: 'direct', backgroundRemoval: true });
    const file = { buffer: Buffer.from('x'), mimetype: 'image/png', originalname: 'look.png' } as Express.Multer.File;
    await expect(ctrl.image(file, 'true', 'landscape', 'true')).resolves.toEqual({ url: 'https://api.test/api/v1/media/m1', width: 1600, height: 2000, originalUrl: 'https://api.test/api/v1/media/m2', backgroundRemoved: true });
    expect(layouts).toEqual(['landscape']);
    expect(stored).toEqual([{ name: 'look-cutout.jpg', mime: 'image/jpeg' }, { name: 'look.png', mime: 'image/png' }]);
    const one = await ctrl.image(file, 'true');
    expect(one.originalUrl).toBeNull();
    expect(layouts[1]).toBe('portrait');
  });

  it('falls back to the photo as given when background removal breaks on the server', async () => {
    const stored: string[] = [];
    const uploader = { isConfigured: () => true, upload: async (f: { originalname?: string }) => (stored.push(String(f.originalname)), { url: 'https://api.test/api/v1/media/m9', width: 800, height: 1000 }) };
    const remover = { isAvailable: () => true, cutout: async () => { throw new Error('Failed to allocate memory'); } };
    const ctrl = new AdminUploadsController({ isConfigured: () => false } as never, uploader as never, remover as never);
    const file = { buffer: Buffer.from('x'), mimetype: 'image/jpeg', originalname: 'coat.jpg' } as Express.Multer.File;
    await expect(ctrl.image(file, 'true', 'portrait', 'true')).resolves.toEqual({ url: 'https://api.test/api/v1/media/m9', width: 800, height: 1000, originalUrl: null, backgroundRemoved: false });
    expect(stored).toEqual(['coat.jpg']);
  });
});
