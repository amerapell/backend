/**
 * Worldwide delivery (DHL Express outside Nigeria). Countries are ISO 3166-1 alpha-2 codes; each international
 * delivery zone covers one region, so its fee can reflect DHL's price band. Names come from Intl.DisplayNames.
 * Keep in sync with frontend/src/lib/countries.ts.
 */
export type InternationalZone = 'INTL_AFRICA' | 'INTL_EUROPE' | 'INTL_AMERICAS' | 'INTL_WORLD';
export const INTERNATIONAL_ZONES: InternationalZone[] = ['INTL_AFRICA', 'INTL_EUROPE', 'INTL_AMERICAS', 'INTL_WORLD'];

const AFRICA = 'DZ AO BJ BW BF BI CV CM CF TD KM CG CD CI DJ EG GQ ER SZ ET GA GM GH GN GW KE LS LR LY MG MW ML MR MU MA MZ NA NE RW ST SN SC SL SO ZA SS SD TZ TG TN UG ZM ZW';
const EUROPE = 'AD AL AT BA BE BG BY CH CY CZ DE DK EE ES FI FO FR GB GG GI GR HR HU IE IM IS IT JE LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS SE SI SK SM UA VA';
const AMERICAS = 'US CA';
const WORLD =
  'AE AF AG AI AM AR AS AU AW AZ BB BD BH BM BN BO BR BS BT BZ CL CN CO CR CU CW DM DO EC FJ FM GD GE GT GU GY HK HN HT ID IL IN IQ IR JM JO JP KG KH KI KN KR KW KY KZ LA LB LC LK MH MM MN MO MV MX MY NC NI NP NR NZ OM PA PE PF PG PH PK PR PS PW PY QA SA SB SG SR SV SY TC TH TJ TL TM TO TR TT TV TW UY UZ VC VE VG VI VN VU WS YE';

export const ZONE_COUNTRIES: Record<InternationalZone, string[]> = {
  INTL_AFRICA: AFRICA.split(' '),
  INTL_EUROPE: EUROPE.split(' '),
  INTL_AMERICAS: AMERICAS.split(' '),
  INTL_WORLD: WORLD.split(' '),
};

export function isInternationalZone(code: string | null | undefined): code is InternationalZone {
  return !!code && (INTERNATIONAL_ZONES as string[]).includes(code);
}

/** The international zone a country belongs to (null for Nigeria / unknown codes). */
export function zoneForCountry(code: string): InternationalZone | null {
  const c = code.toUpperCase();
  return INTERNATIONAL_ZONES.find((z) => ZONE_COUNTRIES[z].includes(c)) ?? null;
}

const names = new Intl.DisplayNames(['en'], { type: 'region' });
export function countryName(code: string | null | undefined): string {
  if (!code) return 'Nigeria';
  try {
    return names.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}
