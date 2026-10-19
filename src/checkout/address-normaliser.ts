import { BadRequestException } from '@nestjs/common';
import type { Address } from '../common/contract';
import { countryName, isInternationalZone, zoneForCountry } from '../common/countries';
import { canonicalState, lgasFor } from '../common/nigeria/states';
import { normalizeInternationalPhone, normalizeNigerianPhone } from '../common/phone';
import type { AddressSnapshot } from '../db/schema';

/**
 * CHK-3: validates and normalises a delivery address.
 * Nigeria: phone → E.164, canonical state, LGA matched leniently.
 * Abroad (DHL): the country must belong to the chosen delivery region; city and street are required; any phone with
 * its country code. `zone` = the delivery zone code (omit for a saved address, where the country decides).
 */
export function normaliseAddress(a: Address, zone?: string): AddressSnapshot {
  const country = (a.country || 'NG').trim().toUpperCase();
  const abroad = country !== 'NG';
  if (zone && isInternationalZone(zone) !== abroad) {
    throw new BadRequestException(abroad ? 'Choose a DHL delivery option for an address outside Nigeria' : 'Choose a Nigerian delivery option for an address in Nigeria');
  }
  if (!abroad) {
    const phone = normalizeNigerianPhone(a.phone);
    if (!phone) throw new BadRequestException('Enter a valid Nigerian phone number for delivery (080… or +234…)');
    const state = canonicalState(a.state);
    if (!state) throw new BadRequestException('Choose a Nigerian state');
    if (!a.area?.trim()) throw new BadRequestException('Enter the area or neighbourhood');
    if (!a.street?.trim()) throw new BadRequestException('Enter the street address');
    const lgaInput = (a.lga ?? '').trim();
    const lga = lgasFor(state).find((l) => l.toLowerCase() === lgaInput.toLowerCase()) ?? lgaInput;
    return {
      fullName: a.fullName.trim(),
      phone,
      state,
      lga,
      area: a.area.trim(),
      street: a.street.trim(),
      landmark: (a.landmark ?? '').trim(),
      note: a.note?.trim() || null,
    };
  }
  const region = zoneForCountry(country);
  if (!region) throw new BadRequestException('We cannot deliver to that country yet — message us on WhatsApp');
  if (zone && zone !== region) throw new BadRequestException(`${countryName(country)} is not in that delivery region — choose the matching DHL option`);
  const phone = normalizeInternationalPhone(a.phone);
  if (!phone) throw new BadRequestException('Enter a phone number with its country code (e.g. +44 7700 900123) so DHL can reach you');
  if (!a.lga?.trim()) throw new BadRequestException('Enter the town or city');
  if (!a.street?.trim()) throw new BadRequestException('Enter the street address');
  return {
    fullName: a.fullName.trim(),
    phone,
    state: (a.state ?? '').trim(),
    lga: a.lga.trim(),
    area: (a.area ?? '').trim(),
    street: a.street.trim(),
    landmark: (a.landmark ?? '').trim(),
    note: a.note?.trim() || null,
    country,
    postcode: (a.postcode ?? '').trim().toUpperCase(),
  };
}

/** One-line-per-part address for emails, packing slips and admin (country shown only abroad). */
export function addressLines(a: Pick<AddressSnapshot, 'street' | 'area' | 'lga' | 'state' | 'country' | 'postcode'>): string[] {
  if (a.country && a.country !== 'NG') {
    return [a.street, [a.area, a.lga].filter(Boolean).join(', '), [a.state, a.postcode].filter(Boolean).join(' '), countryName(a.country)].filter((l) => l && l.trim());
  }
  return [a.street, `${a.area}, ${a.lga}`, a.state].filter((l) => l && l.trim());
}
