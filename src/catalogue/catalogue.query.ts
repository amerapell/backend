import { BadRequestException } from '@nestjs/common';
import { parsePage } from '../common/pagination';
import type { ListQuery } from './catalogue.service';
import type { SortKey } from './catalogue.repository';

const SORTS: SortKey[] = ['newest', 'price_asc', 'price_desc'];

const list = (v: unknown): string[] | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  const arr = Array.isArray(v) ? v : String(v).split(',');
  const out = arr.map((s) => String(s).trim()).filter(Boolean);
  return out.length ? out : undefined;
};

const int = (v: unknown, name: string): number | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new BadRequestException(`${name} must be a non-negative integer (kobo)`);
  return n;
};

/** Parses the shared catalogue query string (?page&pageSize&size&colour&minKobo&maxKobo&inStock&sort&q&collection). */
export function parseListQuery(raw: Record<string, unknown>): ListQuery {
  const { page, pageSize } = parsePage(raw.page, raw.pageSize);
  const sort = (raw.sort as SortKey) ?? 'newest';
  if (!SORTS.includes(sort)) throw new BadRequestException(`sort must be one of ${SORTS.join(', ')}`);
  return {
    page,
    pageSize,
    sort,
    q: typeof raw.q === 'string' && raw.q.trim() ? raw.q.trim().slice(0, 100) : undefined,
    collectionSlug: typeof raw.collection === 'string' && raw.collection ? raw.collection : undefined,
    sizes: list(raw.size),
    colours: list(raw.colour),
    minKobo: int(raw.minKobo, 'minKobo'),
    maxKobo: int(raw.maxKobo, 'maxKobo'),
    inStock: raw.inStock === 'true' || raw.inStock === true || raw.inStock === '1',
  };
}
