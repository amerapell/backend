import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ImageDto } from '../src/admin/products/admin-products.dto';

/* Each product photo carries how much of its frame it fills (100 = edge to edge, down to 50 for a packshot). */
describe('product image scale', () => {
  const check = async (scale: unknown) => (await validate(plainToInstance(ImageDto, { url: 'https://res.cloudinary.com/x/a.jpg', alt: 'a', scale }))).length;
  it('accepts 50–100 or nothing, rejects anything else', async () => {
    expect(await check(undefined)).toBe(0);
    expect(await check(78)).toBe(0);
    expect(await check(100)).toBe(0);
    expect(await check(49)).toBeGreaterThan(0);
    expect(await check(120)).toBeGreaterThan(0);
    expect(await check(77.5)).toBeGreaterThan(0);
  });
});
