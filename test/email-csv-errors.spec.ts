import { BadRequestException, HttpException, NotFoundException } from '@nestjs/common';
import { toApiError } from '../src/common/filters/http-exception.filter';
import { parseCsv, toCsv } from '../src/common/csv';
import { contactFormEmail, exchangeApprovedEmail, orderConfirmationEmail, orderStatusEmail, passwordResetEmail } from '../src/email/templates';
import type { Exchange, Order } from '../src/common/contract';
import { signCloudinaryParams } from '../src/storage/cloudinary-signature';
import { createHash } from 'crypto';

const order: Order = {
  id: 'o1',
  number: 'AP-10511',
  status: 'PAID',
  email: 'ada@example.com',
  phone: '+2348031234567',
  items: [{ id: 'i1', name: 'Cropped leather jacket', number: 'No. 014', colour: 'Black', size: 'M', unitKobo: 18_500_000, quantity: 1, imageUrl: null, exchangeable: true }],
  delivery: { zone: 'LEKKI_AJAH', name: 'Lekki – Ajah', feeKobo: 450_000, address: { fullName: 'Ada <script>', phone: '+2348031234567', state: 'Lagos', lga: 'Eti-Osa', area: 'Lekki', street: '1 Road', landmark: '' } },
  subtotalKobo: 18_500_000,
  discountKobo: 0,
  creditAppliedKobo: 0,
  deliveryKobo: 450_000,
  totalKobo: 18_950_000,
  amountDueKobo: 18_950_000,
  payment: { provider: 'PAYSTACK', reference: 'AP-10511-x', status: 'SUCCEEDED' },
  createdAt: '2026-10-13T12:00:00.000Z',
  paidAt: '2026-10-13T12:01:00.000Z',
  deliveredAt: null,
  exchangeableUntil: null,
};
const ctx = {
  frontendUrl: 'https://shop.test',
  settings: { pickupAddress: '12 Store St, Victoria Island, Lagos', openingHours: 'Mon–Sat 10–7', whatsappNumber: '+234800', contactEmail: 'a@b.c', contactPhone: '+234800', exchangeWindowDays: 7 },
};

describe('email templates (brand-styled, escaped)', () => {
  it('order confirmation: number, items, ₦ totals, exchange-only note, escaped input', () => {
    const e = orderConfirmationEmail(order, ctx);
    expect(e.subject).toBe('Order AP-10511 confirmed — Amerapelle');
    expect(e.html).toContain('#0b1c4f');
    expect(e.html).toContain('Georgia');
    expect(e.html).toContain('₦189,500');
    expect(e.html).toContain('Exchange, not refund');
    expect(e.html).toContain('Ada &lt;script&gt;');
    expect(e.html).not.toContain('<script>');
    expect(e.text).toContain('Total paid: ₦189,500');
  });
  it('status emails only for dispatched / ready / delivered', () => {
    expect(orderStatusEmail({ ...order, status: 'DISPATCHED' }, ctx)?.subject).toContain('on its way');
    expect(orderStatusEmail({ ...order, status: 'READY_FOR_PICKUP' }, ctx)?.html).toContain('12 Store St');
    expect(orderStatusEmail({ ...order, status: 'DELIVERED' }, ctx)?.subject).toContain('delivered');
    expect(orderStatusEmail({ ...order, status: 'PROCESSING' }, ctx)).toBeNull();
  });
  it('exchange approval carries return instructions and the store address', () => {
    const ex: Exchange = {
      id: 'e1', number: 'EX-2031', orderNumber: 'AP-10511', status: 'APPROVED', reason: 'Wrong size', note: null, photoUrls: [],
      items: [{ orderItemId: 'i1', name: 'Cropped leather jacket', quantity: 1, valueKobo: 18_500_000 }], creditKobo: 0, history: [], createdAt: '',
    };
    const e = exchangeApprovedEmail(ex, ctx);
    expect(e.html).toContain('12 Store St, Victoria Island, Lagos');
    expect(e.html).toContain('EX-2031');
    expect(e.html).toContain('unworn');
  });
  it('password reset and contact form', () => {
    expect(passwordResetEmail('Ada', 'https://shop.test/r?token=abc').html).toContain('https://shop.test/r?token=abc');
    const c = contactFormEmail({ name: 'Bo', email: 'b@x.co', subject: 'Hi & <b>', message: 'line1\nline2' });
    expect(c.html).toContain('line1<br>line2');
    expect(c.html).toContain('Hi &amp; &lt;b&gt;');
  });
});

describe('CSV', () => {
  it('round-trips quotes, commas and newlines', () => {
    const rows = [['sku', 'product', 'colour', 'size', 'stock'], ['AP-014-BLA-M', 'Jacket, "cropped"', 'Black', 'M', '4']];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
    expect(parseCsv('﻿sku,stock\r\nA,1\r\n\r\nB,2')).toEqual([['sku', 'stock'], ['A', '1'], ['B', '2']]);
  });
});

describe('error shape (contract)', () => {
  it('maps exceptions to { statusCode, message, error }', () => {
    expect(toApiError(new NotFoundException('Order not found'))).toEqual({ statusCode: 404, message: 'Order not found', error: 'Not Found' });
    expect(toApiError(new BadRequestException(['email must be an email']))).toEqual({ statusCode: 400, message: ['email must be an email'], error: 'Bad Request' });
    expect(toApiError(new HttpException('Nope', 418))).toEqual({ statusCode: 418, message: 'Nope', error: "I'm a Teapot" });
    expect(toApiError(new Error('db exploded'))).toEqual({ statusCode: 500, message: 'Internal server error', error: 'Internal Server Error' });
  });
});

describe('Cloudinary signature', () => {
  it('is SHA-1 of sorted params + secret', () => {
    const sig = signCloudinaryParams({ timestamp: 1315060510, folder: 'amerapelle/products', api_key: 'ignored' }, 'abcd');
    expect(sig).toBe(createHash('sha1').update('folder=amerapelle/products&timestamp=1315060510abcd').digest('hex'));
  });
});
