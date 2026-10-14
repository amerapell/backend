import type { Colour } from '../common/contract';

export interface MatrixInput {
  productNumber: string;
  colours: Colour[];
  sizes: string[];
  priceKobo: number;
  compareAtKobo: number | null;
}

export interface MatrixVariant {
  sku: string;
  colour: string | null;
  colourHex: string | null;
  size: string | null;
  priceKobo: number;
  compareAtKobo: number | null;
  position: number;
}

function code(value: string, len: number): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, len) || 'X';
}

/** "No. 014" -> "014"; anything else -> alphanumerics. */
export function numberCode(productNumber: string): string {
  const digits = productNumber.replace(/[^0-9]/g, '');
  return digits || code(productNumber, 8);
}

export function skuFor(productNumber: string, colour: string | null, size: string | null): string {
  const parts = ['AP', numberCode(productNumber)];
  if (colour) parts.push(code(colour, 3));
  if (size) parts.push(code(size, 6));
  return parts.join('-');
}

/**
 * ADM-1: generates the variant matrix from chosen sizes × colours (colour-major order, matching
 * the gallery/swatch order). A product with no options gets exactly one variant.
 */
export function generateVariantMatrix(input: MatrixInput): MatrixVariant[] {
  const colours: (Colour | null)[] = input.colours.length ? dedupeColours(input.colours) : [null];
  const sizes: (string | null)[] = input.sizes.length ? dedupe(input.sizes.map((s) => s.trim()).filter(Boolean)) : [null];
  const out: MatrixVariant[] = [];
  const seenSkus = new Map<string, number>();
  let position = 0;
  for (const c of colours) {
    for (const s of sizes) {
      let sku = skuFor(input.productNumber, c?.name ?? null, s);
      const n = seenSkus.get(sku) ?? 0;
      seenSkus.set(sku, n + 1);
      if (n > 0) sku = `${sku}${n + 1}`;
      out.push({
        sku,
        colour: c?.name ?? null,
        colourHex: c?.hex ?? null,
        size: s,
        priceKobo: input.priceKobo,
        compareAtKobo: input.compareAtKobo,
        position: position++,
      });
    }
  }
  return out;
}

export interface ExistingVariantKey {
  id: string;
  colour: string | null;
  size: string | null;
  archived: boolean;
}

export interface MatrixDiff {
  /** Existing variants that survive (re-activated if they were archived), with their new position/hex. */
  keep: { id: string; desired: MatrixVariant }[];
  create: MatrixVariant[];
  /** Variant ids no longer in the matrix — archived, never deleted (order history references them). */
  archive: string[];
}

const keyOf = (colour: string | null, size: string | null) => `${(colour ?? '').toLowerCase()}|${(size ?? '').toLowerCase()}`;

/** Diffs the current variants against a newly generated matrix so stock/price on surviving variants is preserved. */
export function diffVariantMatrix(existing: ExistingVariantKey[], desired: MatrixVariant[]): MatrixDiff {
  const byKey = new Map(existing.map((e) => [keyOf(e.colour, e.size), e]));
  const keep: MatrixDiff['keep'] = [];
  const create: MatrixVariant[] = [];
  const used = new Set<string>();
  for (const d of desired) {
    const match = byKey.get(keyOf(d.colour, d.size));
    if (match) {
      keep.push({ id: match.id, desired: d });
      used.add(match.id);
    } else create.push(d);
  }
  const archive = existing.filter((e) => !used.has(e.id) && !e.archived).map((e) => e.id);
  return { keep, create, archive };
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((v) => {
    const k = v.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function dedupeColours(values: Colour[]): Colour[] {
  const seen = new Set<string>();
  return values
    .map((c) => ({ name: c.name.trim(), hex: c.hex.trim() }))
    .filter((c) => {
      const k = c.name.toLowerCase();
      if (!c.name || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}
