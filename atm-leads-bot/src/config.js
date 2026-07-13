/** @typedef {'high' | 'medium' | 'low'} IntentTier */

export const USER_AGENT =
  'HannibalATMLeadsBot/1.0 (+https://hanibalai.com; headbot@hanibalai.com)';

/** Phrases that strongly suggest a location wants an ATM hosted / installed. */
export const INTENT_QUERIES = [
  'looking for ATM',
  'need an ATM',
  'need ATM for my store',
  'want ATM in my business',
  'ATM placement needed',
  'host an ATM',
  'ATM free location',
  'place ATM at my',
  'ATM for my restaurant',
  'ATM for my bar',
  'ATM for my gas station',
  'looking to host ATM',
  'ATM wanted',
  'seeking ATM operator',
];

/** High-weight phrase matchers used when scoring a raw hit. */
export const HIGH_INTENT_PATTERNS = [
  /\b(looking\s+for|need|want|seeking|request(ing)?)\b.{0,40}\batm\b/i,
  /\batm\b.{0,40}\b(placement|install(ation)?|operator|provider|company)\b/i,
  /\b(host|place|put)\b.{0,20}\batm\b/i,
  /\batm\s+(wanted|needed|opportunity|free\s+location)\b/i,
  /\bno\s+atm\b.{0,30}\b(nearby|here|in\s+(my|the)\s+(store|shop|bar|restaurant|building))/i,
];

export const MEDIUM_INTENT_PATTERNS = [
  /\batm\s+(placement|business|opportunity|program|partnership)\b/i,
  /\b(cash\s+access|cashless)\b/i,
  /\b(convenience\s+store|gas\s+station|liquor\s+store|bar|nightclub|laundromat|salon|truck\s+stop).{0,40}\batm\b/i,
  /\batm\b.{0,40}\b(revenue|commission|passive\s+income)\b/i,
];

/** Metro areas used for Craigslist RSS + location tagging. */
export const METROS = [
  { id: 'nyc', name: 'New York', craigslist: 'newyork' },
  { id: 'la', name: 'Los Angeles', craigslist: 'losangeles' },
  { id: 'chicago', name: 'Chicago', craigslist: 'chicago' },
  { id: 'houston', name: 'Houston', craigslist: 'houston' },
  { id: 'miami', name: 'Miami', craigslist: 'miami' },
  { id: 'dallas', name: 'Dallas', craigslist: 'dallas' },
  { id: 'phoenix', name: 'Phoenix', craigslist: 'phoenix' },
  { id: 'atlanta', name: 'Atlanta', craigslist: 'atlanta' },
  { id: 'denver', name: 'Denver', craigslist: 'denver' },
  { id: 'seattle', name: 'Seattle', craigslist: 'seattle' },
];

export const DEFAULT_SOURCES = ['reddit', 'news', 'craigslist', 'web', 'osm'];

export const REQUEST_DELAY_MS = 900;
export const REQUEST_TIMEOUT_MS = 55000;
