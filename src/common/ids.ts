import { createId } from '@paralleldrive/cuid2';
import { randomBytes, createHash } from 'crypto';

export const newId = (): string => createId();

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function formatOrderNumber(seq: number): string {
  return `AP-${String(seq).padStart(5, '0')}`;
}

export function formatExchangeNumber(seq: number): string {
  return `EX-${seq}`;
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
