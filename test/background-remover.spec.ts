import { ServiceUnavailableException } from '@nestjs/common';
import { BackgroundRemover, alphaBox, erode, keepMainComponents } from '../src/storage/background-remover';

function rect(mask: Buffer, w: number, x0: number, y0: number, x1: number, y1: number, v = 255) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) mask[y * w + x] = v;
}
const count = (b: Buffer) => b.reduce((n, v) => n + (v ? 1 : 0), 0);

describe('background remover — mask clean-up', () => {
  it('drops specks smaller than 5% of the subject and keeps sizeable parts (e.g. a bag)', () => {
    const w = 100;
    const h = 100;
    const mask = Buffer.alloc(w * h);
    rect(mask, w, 30, 10, 70, 90); // subject: 3200 px
    rect(mask, w, 5, 50, 20, 65); // bag: 225 px (7%) — kept
    rect(mask, w, 90, 5, 93, 8); // speck: 9 px — dropped
    rect(mask, w, 0, 0, 2, 2, 30); // faint noise below threshold — dropped
    keepMainComponents(mask, w, h);
    expect(count(mask)).toBe(3200 + 225);
    expect(mask[6 * w + 91]).toBe(0);
    expect(mask[0]).toBe(0);
  });

  it('erodes the edge by one pixel', () => {
    const w = 20;
    const mask = Buffer.alloc(w * w);
    rect(mask, w, 5, 5, 15, 15);
    expect(count(erode(mask, w, w))).toBe(8 * 8);
  });

  it('finds the subject box, or null when there is no subject', () => {
    const w = 50;
    const mask = Buffer.alloc(w * 40);
    expect(alphaBox(mask, w, 40)).toBeNull();
    rect(mask, w, 10, 5, 30, 35);
    expect(alphaBox(mask, w, 40)).toEqual({ x: 10, y: 5, w: 20, h: 30 });
  });

  it('reports itself unavailable without the model file and refuses politely', async () => {
    const r = new BackgroundRemover('/nonexistent/model.onnx');
    expect(r.isAvailable()).toBe(false);
    await expect(r.cutout(Buffer.from('x'))).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
