import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ImageDto } from '../src/admin/products/admin-products.dto';
import { CreateExchangeDto } from '../src/exchanges/exchanges.dto';

/** Image URLs produced by our own uploaders must pass validation, including built-in media on a TLD-less host. */
describe('image URL validation', () => {
  const urlErrors = async (url: string) => (await validate(plainToInstance(ImageDto, { url, alt: 'Front' }))).map((e) => e.property);

  it.each([
    'http://localhost:4000/api/v1/media/jzcn9y4tdxq8svqdm1la7owx',
    'https://api.amerapelle.com/api/v1/media/jzcn9y4tdxq8svqdm1la7owx',
    'https://res.cloudinary.com/demo/image/upload/v1/amerapelle/products/a.jpg',
  ])('accepts %s for product images', async (url) => {
    expect(await urlErrors(url)).toEqual([]);
  });

  it.each(['javascript:alert(1)', 'ftp://example.com/a.jpg', '/api/v1/media/abc', 'not a url'])('rejects %s', async (url) => {
    expect(await urlErrors(url)).toEqual(['url']);
  });

  it('accepts built-in media URLs as exchange photos', async () => {
    const dto = plainToInstance(CreateExchangeDto, {
      orderNumber: 'AP-10501',
      items: [{ orderItemId: 'item1', quantity: 1 }],
      reason: 'Too small',
      photoUrls: ['http://localhost:4000/api/v1/media/fthetxqz7g7i7h4dwrsorrk5'],
    });
    expect((await validate(dto)).map((e) => e.property)).not.toContain('photoUrls');
  });
});
