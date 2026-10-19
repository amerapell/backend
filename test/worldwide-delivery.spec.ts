import { BadRequestException } from '@nestjs/common';
import { addressLines, normaliseAddress } from '../src/checkout/address-normaliser';
import { computeQuote } from '../src/checkout/pricing';
import { countryName, zoneForCountry } from '../src/common/countries';
import { trackingUrl } from '../src/orders/order-presenter';
import { normalizeInternationalPhone } from '../src/common/phone';

const uk = { fullName: 'Ada Obi', phone: '+44 7700 900123', country: 'gb', state: '', lga: 'London', area: 'Peckham', street: '12 Rye Lane', landmark: '', postcode: 'se15 4st' };

describe('worldwide delivery (DHL)', () => {
  it('maps countries to their DHL region; Nigeria is not international', () => {
    expect(zoneForCountry('GB')).toBe('INTL_EUROPE');
    expect(zoneForCountry('us')).toBe('INTL_AMERICAS');
    expect(zoneForCountry('GH')).toBe('INTL_AFRICA');
    expect(zoneForCountry('AE')).toBe('INTL_WORLD');
    expect(zoneForCountry('NG')).toBeNull();
    expect(countryName('GB')).toBe('United Kingdom');
  });

  it('accepts international phone numbers with a country code', () => {
    expect(normalizeInternationalPhone('+44 7700 900123')).toBe('+447700900123');
    expect(normalizeInternationalPhone('001 212 555 0100')).toBe('+12125550100');
    expect(normalizeInternationalPhone('08031234567')).toBe('+2348031234567');
    expect(normalizeInternationalPhone('7700 900123')).toBeNull();
  });

  it('normalises an address abroad and checks it matches the chosen DHL region', () => {
    const a = normaliseAddress(uk, 'INTL_EUROPE');
    expect(a).toMatchObject({ country: 'GB', postcode: 'SE15 4ST', lga: 'London', phone: '+447700900123' });
    expect(addressLines(a)).toEqual(['12 Rye Lane', 'Peckham, London', 'SE15 4ST', 'United Kingdom']);
    expect(() => normaliseAddress(uk, 'INTL_AMERICAS')).toThrow('not in that delivery region');
    expect(() => normaliseAddress(uk, 'LAGOS_ISLAND')).toThrow(BadRequestException);
    expect(() => normaliseAddress({ ...uk, lga: '' }, 'INTL_EUROPE')).toThrow('town or city');
    expect(() => normaliseAddress({ ...uk, phone: '07700 900123' }, 'INTL_EUROPE')).toThrow('country code');
  });

  it('a Nigerian address cannot use a DHL option, and Nigerian rules are unchanged', () => {
    const ng = { fullName: 'Ada', phone: '0803 123 4567', state: 'Lagos', lga: 'Eti-Osa', area: 'Lekki', street: '1 Admiralty Way', landmark: '' };
    expect(() => normaliseAddress(ng, 'INTL_AFRICA')).toThrow('Nigerian delivery option');
    expect(normaliseAddress(ng, 'LEKKI_AJAH')).toMatchObject({ state: 'Lagos', phone: '+2348031234567' });
    expect(normaliseAddress(ng, 'LEKKI_AJAH').country).toBeUndefined();
  });

  it('the free-delivery threshold applies in Nigeria only — DHL is always charged', () => {
    const base = { subtotalKobo: 50_000_000, discountKobo: 0, freeDeliveryPromo: false, freeDeliveryThresholdKobo: 30_000_000, creditAvailableKobo: 0, useCredit: false };
    expect(computeQuote({ ...base, zone: { code: 'LAGOS_ISLAND', feeKobo: 500_000 } }).deliveryKobo).toBe(0);
    expect(computeQuote({ ...base, zone: { code: 'INTL_EUROPE', feeKobo: 7_500_000 } }).deliveryKobo).toBe(7_500_000);
  });

  it('links DHL tracking only for orders abroad that have a tracking number', () => {
    expect(trackingUrl('INTL_EUROPE', '1234567890')).toBe('https://www.dhl.com/global-en/home/tracking/tracking-express.html?submit=1&tracking-id=1234567890');
    expect(trackingUrl('INTL_EUROPE', null)).toBeNull();
    expect(trackingUrl('LAGOS_ISLAND', '1234567890')).toBeNull();
  });
});
