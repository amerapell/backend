import { BadRequestException } from '@nestjs/common';
import type { Address } from '../common/contract';
import { canonicalState, lgasFor } from '../common/nigeria/states';
import { normalizeNigerianPhone } from '../common/phone';
import type { AddressSnapshot } from '../db/schema';

/** CHK-3: validates and normalises a Nigerian address (phone → E.164, canonical state, LGA matched leniently). */
export function normaliseAddress(a: Address): AddressSnapshot {
  const phone = normalizeNigerianPhone(a.phone);
  if (!phone) throw new BadRequestException('Enter a valid Nigerian phone number for delivery (080… or +234…)');
  const state = canonicalState(a.state);
  if (!state) throw new BadRequestException('Choose a Nigerian state');
  const lgaInput = a.lga.trim();
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
