/**
 * Canada location matching.
 *
 * Real location strings are messy. From live Greenhouse/GitHub data:
 *   "Toronto"                                     -> bare city, no country
 *   "Toronto, Canada"                             -> easy
 *   "Canada"                                      -> country only
 *   "New York, San Francisco, Seattle, or Remote (US/Canada)" -> multi, partial
 *   "Vancouver, Canada +1"                        -> GitHub's multi-location suffix
 *
 * Policy from CLAUDE.md: when ambiguous, keep it and flag it rather than drop it.
 */

export const PROVINCES: Record<string, string> = {
  ontario: 'ON',
  quebec: 'QC',
  'québec': 'QC',
  'british columbia': 'BC',
  alberta: 'AB',
  manitoba: 'MB',
  saskatchewan: 'SK',
  'nova scotia': 'NS',
  'new brunswick': 'NB',
  'newfoundland and labrador': 'NL',
  newfoundland: 'NL',
  'prince edward island': 'PE',
  'northwest territories': 'NT',
  nunavut: 'NU',
  yukon: 'YT',
};

const PROVINCE_CODES = new Set(Object.values(PROVINCES));

/** Major Canadian cities -> province. Bare-city strings are common and have no country. */
export const CITIES: Record<string, string> = {
  toronto: 'ON', ottawa: 'ON', mississauga: 'ON', brampton: 'ON', hamilton: 'ON',
  london: 'ON', kitchener: 'ON', waterloo: 'ON', windsor: 'ON', markham: 'ON',
  vaughan: 'ON', burlington: 'ON', oakville: 'ON', guelph: 'ON', kingston: 'ON',
  montreal: 'QC', 'montréal': 'QC', 'quebec city': 'QC', laval: 'QC',
  gatineau: 'QC', sherbrooke: 'QC',
  vancouver: 'BC', burnaby: 'BC', surrey: 'BC', richmond: 'BC', victoria: 'BC',
  kelowna: 'BC', 'north vancouver': 'BC',
  calgary: 'AB', edmonton: 'AB', 'red deer': 'AB',
  winnipeg: 'MB', regina: 'SK', saskatoon: 'SK',
  halifax: 'NS', dartmouth: 'NS', moncton: 'NB', fredericton: 'NB',
  "st. john's": 'NL', "st john's": 'NL', charlottetown: 'PE',
  whitehorse: 'YT', yellowknife: 'NT', iqaluit: 'NU',
};

/**
 * "London" is Ontario *and* England; "Vancouver" is BC *and* Washington.
 * Only treat these as Canadian with corroborating evidence.
 */
const AMBIGUOUS_CITIES = new Set(['london', 'vancouver', 'windsor', 'kingston', 'richmond', 'victoria']);

/** Countries that, if named, mean the city is NOT the Canadian one. */
const FOREIGN_MARKERS = [
  'united kingdom', ' uk', 'england', 'united states', ' usa', ' u.s.',
  'australia', 'india', 'germany', 'france', 'japan', 'china', 'singapore',
  'brazil', 'ireland', 'netherlands', 'spain', 'italy', 'poland', 'israel',
  'mexico', 'sweden', 'switzerland', 'korea', 'taiwan', 'new zealand',
];

export interface CanadaMatch {
  isCanada: boolean;
  confidence: 'confirmed' | 'ambiguous';
  province: string | null;
  remote: boolean;
  /** Which rule fired, for tuning. */
  matchedBy: string | null;
}

const NO_MATCH: CanadaMatch = {
  isCanada: false, confidence: 'ambiguous', province: null, remote: false, matchedBy: null,
};

export function matchCanada(rawLocation: string): CanadaMatch {
  const loc = (rawLocation ?? '').toLowerCase().trim();
  if (!loc) return NO_MATCH;

  const remote = /\bremote\b|\bwork from home\b|\bwfh\b|\bdistributed\b/.test(loc);
  const mentionsCanada = /\bcanada\b|\bcanadian\b/.test(loc);

  // "Remote (US/Canada)" / "Remote - North America" — genuinely open to Canada.
  if (remote && (mentionsCanada || /north america|americas|global|worldwide|anywhere/.test(loc))) {
    return {
      isCanada: true,
      confidence: mentionsCanada ? 'confirmed' : 'ambiguous',
      province: null,
      remote: true,
      matchedBy: mentionsCanada ? 'remote-canada' : 'remote-broad-region',
    };
  }

  // Explicit province name or code, e.g. "Toronto, ON" / "Ontario, Canada".
  for (const [name, code] of Object.entries(PROVINCES)) {
    if (new RegExp(`\\b${name}\\b`).test(loc)) {
      return { isCanada: true, confidence: 'confirmed', province: code, remote, matchedBy: `province:${name}` };
    }
  }
  for (const code of PROVINCE_CODES) {
    const c = code.toLowerCase();
    // Anchored forms only, so "on"/"be" inside words don't false-positive.
    // Job Bank uses "Havelock (ON)"; ATS boards use "Toronto, ON".
    if (new RegExp(`\\(\\s*${c}\\s*\\)`).test(loc) || new RegExp(`,\\s*${c}\\b`).test(loc)) {
      return { isCanada: true, confidence: 'confirmed', province: code, remote, matchedBy: `province-code:${code}` };
    }
  }

  const foreign = FOREIGN_MARKERS.find((m) => loc.includes(m));

  // Known city name.
  for (const [city, code] of Object.entries(CITIES)) {
    if (!new RegExp(`\\b${city.replace(/[.']/g, '\\$&')}\\b`).test(loc)) continue;

    if (AMBIGUOUS_CITIES.has(city)) {
      // "Vancouver, Canada" -> confirmed. Bare "Vancouver" -> keep but flag.
      if (mentionsCanada) {
        return { isCanada: true, confidence: 'confirmed', province: code, remote, matchedBy: `city:${city}+canada` };
      }
      if (foreign) return NO_MATCH;
      return { isCanada: true, confidence: 'ambiguous', province: code, remote, matchedBy: `city-ambiguous:${city}` };
    }

    // Unambiguous Canadian city named alongside a foreign country is a multi-location
    // posting ("Toronto, Berlin") — keep, but flag it.
    if (foreign && !mentionsCanada) {
      return { isCanada: true, confidence: 'ambiguous', province: code, remote, matchedBy: `city-multi:${city}` };
    }
    return { isCanada: true, confidence: 'confirmed', province: code, remote, matchedBy: `city:${city}` };
  }

  if (mentionsCanada) {
    // "Canada" alone, or "US/Canada" style multi-country.
    const multiCountry = Boolean(foreign);
    return {
      isCanada: true,
      confidence: multiCountry ? 'ambiguous' : 'confirmed',
      province: null,
      remote,
      matchedBy: multiCountry ? 'canada-multi-country' : 'canada',
    };
  }

  return NO_MATCH;
}
