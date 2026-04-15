/**
 * IOC (3-letter) codes used in Judo draws → ISO 3166-1 alpha-2 for flag SVG URLs.
 * Never use the first two letters of an unknown IOC code as ISO (e.g. BRN → "BR" would be Brazil; BRN is Bahrain).
 */
export const IOC_TO_ISO: Record<string, string> = {
  FRA: 'fr',
  JPN: 'jp',
  KAZ: 'kz',
  GEO: 'ge',
  BRA: 'br',
  UZB: 'uz',
  MGL: 'mn',
  KOR: 'kr',
  AZE: 'az',
  ISR: 'il',
  ITA: 'it',
  ESP: 'es',
  CAN: 'ca',
  CUB: 'cu',
  GER: 'de',
  NED: 'nl',
  BEL: 'be',
  TUR: 'tr',
  UKR: 'ua',
  GBR: 'gb',
  USA: 'us',
  POR: 'pt',
  HUN: 'hu',
  SRB: 'rs',
  KOS: 'xk',
  TJK: 'tj',
  CZE: 'cz',
  POL: 'pl',
  ROU: 'ro',
  AUT: 'at',
  SUI: 'ch',
  CHN: 'cn',
  TPE: 'tw',
  KGZ: 'kg',
  TKM: 'tm',
  CRO: 'hr',
  MDA: 'md',
  AUS: 'au',
  UAE: 'ae',
  SWE: 'se',
  AIN: 'ru',
  RUS: 'ru',
  IJF: 'xx',
  /** Bahrain — NOT Brazil (BRA) */
  BRN: 'bh',
  BHR: 'bh',
  /** Botswana */
  BOT: 'bw',
  /** Bolivia */
  BOL: 'bo',
  /** Bangladesh */
  BAN: 'bd',
  /** Bulgaria */
  BUL: 'bg',
  /** Greece */
  GRE: 'gr',
  /** India */
  IND: 'in',
  /** Belarus — IOC code BLR */
  BLR: 'by',
  /** Vietnam */
  VIE: 'vn',
  /** Thailand */
  THA: 'th',
  /** Egypt */
  EGY: 'eg',
  /** Argentina */
  ARG: 'ar',
  /** Colombia */
  COL: 'co',
  /** Mexico */
  MEX: 'mx',
  /** Norway */
  NOR: 'no',
  /** Denmark */
  DEN: 'dk',
  /** Finland */
  FIN: 'fi',
  /** Slovakia */
  SVK: 'sk',
  /** Slovenia */
  SLO: 'si',
  /** Sweden already SWE */
  /** Latvia */
  LAT: 'lv',
  /** Estonia */
  EST: 'ee',
  /** Lithuania */
  LTU: 'lt',
  /** Morocco */
  MAR: 'ma',
  /** Algeria */
  ALG: 'dz',
  /** Tunisia */
  TUN: 'tn',
  /** Nigeria */
  NGR: 'ng',
  /** South Africa */
  RSA: 'za',
  /** New Zealand */
  NZL: 'nz',
  /** Iran */
  IRI: 'ir',
  /** Iraq */
  IRQ: 'iq',
  /** Saudi Arabia */
  KSA: 'sa',
  /** Qatar */
  QAT: 'qa',
  /** Kuwait */
  KUW: 'kw',
  /** Oman */
  OMA: 'om',
  /** Yemen */
  YEM: 'ye',
  /** Syria */
  SYR: 'sy',
  /** Jordan */
  JOR: 'jo',
  /** Lebanon */
  LIB: 'lb',
  /** Cyprus */
  CYP: 'cy',
  /** Malta */
  MLT: 'mt',
  /** Iceland */
  ISL: 'is',
  /** Ireland */
  IRL: 'ie',
  /** Luxembourg */
  LUX: 'lu',
  /** Monaco */
  MON: 'mc',
  /** San Marino */
  SMR: 'sm',
  /** Andorra */
  AND: 'ad',
  /** Liechtenstein */
  LIE: 'li',
  /** Armenia */
  ARM: 'am',
  /** Azerbaijan already AZE */
};

/** Resolve IOC or 2-letter ISO to lowercase ISO alpha-2 for flag-icons. Returns null if unknown 3-letter IOC (do not guess). */
export function resolveFlagIso(code: string): string | null {
  const c = code.trim().toUpperCase();
  if (!c) return null;
  if (IOC_TO_ISO[c]) return IOC_TO_ISO[c].toLowerCase();
  if (c.length === 2) return c.toLowerCase();
  return null;
}
