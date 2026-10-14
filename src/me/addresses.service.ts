import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Address } from '../common/contract';
import type { AddressRow, AddressSnapshot } from '../db/schema';
import { normaliseAddress } from '../checkout/address-normaliser';
import { ME_REPOSITORY, MeRepository } from './me.repository';

export function toAddress(a: AddressRow): Address {
  return {
    id: a.id,
    fullName: a.fullName,
    phone: a.phone,
    state: a.state,
    lga: a.lga,
    area: a.area,
    street: a.street,
    landmark: a.landmark,
    note: a.note,
  };
}

/** ACC-3 saved addresses. */
@Injectable()
export class AddressesService {
  constructor(@Inject(ME_REPOSITORY) private readonly repo: MeRepository) {}

  async list(userId: string): Promise<Address[]> {
    return (await this.repo.addresses(userId)).map(toAddress);
  }

  async create(userId: string, input: Address): Promise<Address> {
    const a = normaliseAddress(input);
    return toAddress(await this.repo.createAddress(userId, { ...a, note: a.note ?? null }));
  }

  async update(userId: string, id: string, input: Address): Promise<Address> {
    const a = normaliseAddress(input);
    const row = await this.repo.updateAddress(userId, id, { ...a, note: a.note ?? null });
    if (!row) throw new NotFoundException('Address not found');
    return toAddress(row);
  }

  async remove(userId: string, id: string): Promise<Address[]> {
    if (!(await this.repo.deleteAddress(userId, id))) throw new NotFoundException('Address not found');
    return this.list(userId);
  }

  /** Called from checkout with "save this address": skips exact duplicates. */
  async saveIfNew(userId: string, a: AddressSnapshot): Promise<void> {
    const existing = await this.repo.addresses(userId);
    const key = (x: Pick<AddressSnapshot, 'street' | 'area' | 'lga' | 'state' | 'phone'>) =>
      [x.street, x.area, x.lga, x.state, x.phone].map((v) => v.trim().toLowerCase()).join('|');
    if (existing.some((e) => key(e) === key(a))) return;
    await this.repo.createAddress(userId, { ...a, note: a.note ?? null });
  }
}
