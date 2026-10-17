import { existsSync } from 'fs';
import { join } from 'path';
import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import sharp from 'sharp';
import type { InferenceSession } from 'onnxruntime-node';
import { MAX_INPUT_PIXELS } from './image-processor';

/** The stage ground every cut-out sits on (design v3 `--stage`). */
export const STAGE_RGB = { r: 237, g: 236, b: 232 } as const;

/** portrait = product shot (4:5), landscape = collection hero (3:2). */
export type CutoutLayout = 'portrait' | 'landscape';

const MODEL_SIZE = 1024;
const IDLE_RELEASE_MS = 10 * 60_000;
const CANVAS: Record<CutoutLayout, { width: number; height: number; figure: number }> = {
  portrait: { width: 1600, height: 2000, figure: 0.86 },
  landscape: { width: 2400, height: 1600, figure: 0.84 },
};
const BOTTOM_MARGIN = 0.06;
/** Work on the mask at most this size (long edge) — keeps the pure-JS clean-up fast. */
const MASK_MAX = 2000;

export function defaultModelPath(): string {
  return process.env.BG_MODEL_PATH || join(__dirname, '..', '..', 'models', 'isnet-general-use.onnx');
}

/**
 * Cuts the subject out of a photo and places it on the stage ground, like a studio packshot.
 * Model: IS-Net (DIS, "isnet-general-use", Apache-2.0) run locally with onnxruntime — no third-party service, no
 * per-image fee. Loaded lazily on first use (~180 MB on disk, ~1 GB peak RAM during a run) and runs one image at a
 * time so concurrent uploads cannot multiply memory.
 */
@Injectable()
export class BackgroundRemover {
  private readonly log = new Logger(BackgroundRemover.name);
  private session: Promise<InferenceSession> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private idleTimer: NodeJS.Timeout | null = null;

  constructor(private readonly modelPath: string = defaultModelPath()) {}

  isAvailable(): boolean {
    return existsSync(this.modelPath);
  }

  /** Returns a JPEG of the cut-out on the stage ground. */
  async cutout(input: Buffer, layout: CutoutLayout = 'portrait'): Promise<Buffer> {
    if (!this.isAvailable()) {
      throw new ServiceUnavailableException('Background removal is not set up on this server — upload the photo without it');
    }
    if (this.idleTimer) clearTimeout(this.idleTimer);
    const run = this.queue.then(() => this.run(input, layout));
    this.queue = run.catch(() => undefined).then(() => this.scheduleRelease());
    return run;
  }

  /** Frees the model's memory after 10 idle minutes; the next upload loads it again (~1 s). */
  private scheduleRelease(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      const s = this.session;
      this.session = null;
      void s?.then((x) => x.release()).catch(() => undefined);
    }, IDLE_RELEASE_MS);
    this.idleTimer.unref();
  }

  private loadSession(): Promise<InferenceSession> {
    if (!this.session) {
      this.session = (async () => {
        const ort = await import('onnxruntime-node');
        const s = await ort.InferenceSession.create(this.modelPath, { graphOptimizationLevel: 'all', enableCpuMemArena: false, enableMemPattern: false, intraOpNumThreads: 2, interOpNumThreads: 1 });
        this.log.log('background-removal model loaded');
        return s;
      })();
      this.session.catch(() => (this.session = null));
    }
    return this.session;
  }

  private async run(input: Buffer, layout: CutoutLayout): Promise<Buffer> {
    let rgb: { data: Buffer; info: sharp.OutputInfo };
    try {
      rgb = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).rotate().removeAlpha().raw().toBuffer({ resolveWithObject: true });
    } catch {
      throw new BadRequestException('That file is not an image we can read');
    }
    const { width, height } = rgb.info;

    // 1. Model input: 1024×1024 RGB, scaled by the image max, minus 0.5 (rembg's DIS preprocessing).
    const small = await sharp(rgb.data, { raw: { width, height, channels: 3 } })
      .resize(MODEL_SIZE, MODEL_SIZE, { fit: 'fill', kernel: 'lanczos3' })
      .raw()
      .toBuffer();
    let max = 1;
    for (let i = 0; i < small.length; i++) if (small[i] > max) max = small[i];
    const plane = MODEL_SIZE * MODEL_SIZE;
    const tensorData = new Float32Array(3 * plane);
    for (let p = 0; p < plane; p++) {
      tensorData[p] = small[p * 3] / max - 0.5;
      tensorData[plane + p] = small[p * 3 + 1] / max - 0.5;
      tensorData[2 * plane + p] = small[p * 3 + 2] / max - 0.5;
    }
    const ort = await import('onnxruntime-node');
    const session = await this.loadSession();
    const feeds = { [session.inputNames[0]]: new ort.Tensor('float32', tensorData, [1, 3, MODEL_SIZE, MODEL_SIZE]) };
    const out = await session.run(feeds);
    const pred = out[session.outputNames[0]].data as Float32Array; // [1,1,1024,1024]

    // 2. Normalise to 0–255.
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < plane; i++) {
      if (pred[i] < lo) lo = pred[i];
      if (pred[i] > hi) hi = pred[i];
    }
    const span = hi - lo || 1;
    const mask1024 = Buffer.alloc(plane);
    for (let i = 0; i < plane; i++) mask1024[i] = Math.round(((pred[i] - lo) / span) * 255);

    // 3. Mask at working size: drop stray specks, pull the edge in 1 px, soften it.
    const scale = Math.min(1, MASK_MAX / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    const mask = await sharp(mask1024, { raw: { width: MODEL_SIZE, height: MODEL_SIZE, channels: 1 } })
      .resize(w, h, { fit: 'fill', kernel: 'lanczos3' })
      .extractChannel(0)
      .raw()
      .toBuffer();
    keepMainComponents(mask, w, h);
    const eroded = erode(mask, w, h);
    const alpha = await sharp(eroded, { raw: { width: w, height: h, channels: 1 } }).blur(0.8).extractChannel(0).raw().toBuffer();

    const bbox = alphaBox(alpha, w, h);
    if (!bbox) throw new BadRequestException('No clear subject found in that photo — upload it without background removal');

    // 4. Subject (RGBA) at working size, cropped to its box.
    const colour = await sharp(rgb.data, { raw: { width, height, channels: 3 } }).resize(w, h, { fit: 'fill' }).raw().toBuffer();
    const rgba = Buffer.alloc(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      rgba[i * 4] = colour[i * 3];
      rgba[i * 4 + 1] = colour[i * 3 + 1];
      rgba[i * 4 + 2] = colour[i * 3 + 2];
      rgba[i * 4 + 3] = alpha[i];
    }
    const canvas = CANVAS[layout];
    let figH = Math.round(canvas.height * canvas.figure);
    let figW = Math.round((bbox.w / bbox.h) * figH);
    if (figW > canvas.width * 0.9) {
      figW = Math.round(canvas.width * 0.9);
      figH = Math.round((bbox.h / bbox.w) * figW);
    }
    const figure = await sharp(rgba, { raw: { width: w, height: h, channels: 4 } })
      .extract({ left: bbox.x, top: bbox.y, width: bbox.w, height: bbox.h })
      .resize(figW, figH, { fit: 'fill', kernel: 'lanczos3' })
      .png()
      .toBuffer();
    const left = Math.round((canvas.width - figW) / 2);
    const top = canvas.height - Math.round(canvas.height * BOTTOM_MARGIN) - figH;

    // 5. A faint floor shadow, then the figure, on the stage ground.
    const shadowSvg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}">` +
        `<defs><filter id="b"><feGaussianBlur stdDeviation="14"/></filter></defs>` +
        `<ellipse cx="${left + figW / 2}" cy="${top + figH}" rx="${figW * 0.3}" ry="14" fill="rgb(160,158,152)" fill-opacity="0.24" filter="url(#b)"/></svg>`,
    );
    return sharp({ create: { width: canvas.width, height: canvas.height, channels: 3, background: STAGE_RGB } })
      .composite([
        { input: shadowSvg, left: 0, top: 0 },
        { input: figure, left, top },
      ])
      .jpeg({ quality: 92, mozjpeg: true })
      .toBuffer();
  }
}

/** Zeroes every connected region (alpha > 40) smaller than 5% of the largest — loose bits of background. */
export function keepMainComponents(mask: Buffer, w: number, h: number): void {
  const labels = new Int32Array(w * h);
  const sizes: number[] = [0];
  const stack: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (labels[start] || mask[start] <= 40) continue;
    const id = sizes.length;
    let size = 0;
    labels[start] = id;
    stack.push(start);
    while (stack.length) {
      const p = stack.pop()!;
      size++;
      const x = p % w;
      const y = (p - x) / w;
      const n = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      for (const q of n) {
        if (q >= 0 && !labels[q] && mask[q] > 40) {
          labels[q] = id;
          stack.push(q);
        }
      }
    }
    sizes.push(size);
  }
  if (sizes.length <= 2) return;
  const largest = Math.max(...sizes);
  for (let i = 0; i < w * h; i++) {
    const l = labels[i];
    if (l && sizes[l] < largest * 0.05) mask[i] = 0;
    else if (!l && mask[i] <= 40) mask[i] = 0;
  }
}

/** 3×3 minimum filter — trims the 1-px halo of old background around the edge. */
export function erode(mask: Buffer, w: number, h: number): Buffer {
  const out = Buffer.alloc(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 255;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const v = mask[yy * w + xx];
          if (v < m) m = v;
        }
      }
      out[y * w + x] = m;
    }
  }
  return out;
}

export function alphaBox(alpha: Buffer, w: number, h: number): { x: number; y: number; w: number; h: number } | null {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (alpha[y * w + x] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0 || x1 - x0 < 8 || y1 - y0 < 8) return null;
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
