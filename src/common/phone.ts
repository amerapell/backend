/**
 * Nigerian phone normalisation. Accepts 080…, 81…, 234…, +234…, with spaces/dashes/brackets,
 * and returns E.164 (+234XXXXXXXXXX). Returns null for anything that is not a valid NG mobile/landline length.
 */
export function normalizeNigerianPhone(input: string | null | undefined): string | null {
  if (!input) return null;
  let digits = String(input).trim().replace(/[\s\-().]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (!/^\d+$/.test(digits)) return null;
  if (digits.startsWith('00234')) digits = digits.slice(2);
  let national: string;
  if (digits.startsWith('234')) {
    national = digits.slice(3);
    if (national.startsWith('0')) national = national.slice(1);
  } else if (digits.startsWith('0')) {
    national = digits.slice(1);
  } else {
    national = digits;
  }
  // Nigerian numbers are 10 digits after the trunk prefix (e.g. 8031234567), mobiles start 7/8/9.
  if (!/^[789][01]\d{8}$/.test(national)) return null;
  return `+234${national}`;
}

export function isValidNigerianPhone(input: string | null | undefined): boolean {
  return normalizeNigerianPhone(input) !== null;
}
