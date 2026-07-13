import { HIGH_INTENT_PATTERNS, MEDIUM_INTENT_PATTERNS, METROS } from './config.js';

const NEGATIVE_PATTERNS = [
  { re: /\b(skimmer|skimmed|theft|stolen|robbery|robbed|burglary|fraud|hacked)\b/i, w: 50, reason: 'crime-news' },
  { re: /\b(police|arrest(ed)?|suspects?|charged)\b/i, w: 25, reason: 'police-blotter' },
  { re: /\b(feng\s+shui|interior\s+design)\b/i, w: 40, reason: 'unrelated-feature' },
  { re: /\bat\s+the\s+moment\b|\bnot\s+looking\s+for\b.{0,20}\batm\b|\batm[,.]?\s+(and\s+we|i\s+get)\b/i, w: 45, reason: 'atm-acronym' },
  { re: /\b(we\s+(place|install|provide|offer)\s+atms?|atm\s+company\s+for\s+hire|buy\s+an?\s+atm|atms?\s+for\s+sale)\b/i, w: 35, reason: 'vendor-pitch' },
  { re: /\b(job|hiring|resume|salary|career)\b/i, w: 20, reason: 'job-post' },
];

/**
 * Score how likely a text snippet indicates a business wants an ATM.
 * @returns {{ score: number, tier: 'high'|'medium'|'low'|'noise', reasons: string[] }}
 */
export function scoreIntent(text = '') {
  const content = String(text);
  const reasons = [];
  let score = 0;

  for (const pattern of HIGH_INTENT_PATTERNS) {
    if (pattern.test(content)) {
      score += 35;
      reasons.push(`high:${pattern.source.slice(0, 48)}`);
    }
  }

  for (const pattern of MEDIUM_INTENT_PATTERNS) {
    if (pattern.test(content)) {
      score += 15;
      reasons.push(`medium:${pattern.source.slice(0, 48)}`);
    }
  }

  for (const neg of NEGATIVE_PATTERNS) {
    if (neg.re.test(content)) {
      score -= neg.w;
      reasons.push(`downrank:${neg.reason}`);
    }
  }

  // Require an explicit ATM / cash machine mention for any positive tier.
  if (!/\b(atm|cash\s+machine|automated\s+teller)\b/i.test(content)) {
    score = 0;
    reasons.push('downrank:no-atm-token');
  }

  score = Math.max(0, Math.min(100, score));

  let tier = 'noise';
  if (score >= 55) tier = 'high';
  else if (score >= 30) tier = 'medium';
  else if (score >= 15) tier = 'low';

  return { score, tier, reasons };
}

export function detectMetro(text = '') {
  const lower = text.toLowerCase();
  for (const metro of METROS) {
    if (lower.includes(metro.name.toLowerCase()) || lower.includes(metro.id)) {
      return metro.name;
    }
  }
  return null;
}

export function enrichLead(raw) {
  const blob = [raw.title, raw.snippet, raw.location].filter(Boolean).join(' · ');
  const intent = scoreIntent(blob);
  const metro = raw.location || detectMetro(blob);

  return {
    ...raw,
    location: metro || raw.location || null,
    score: intent.score,
    tier: intent.tier,
    reasons: intent.reasons,
    scrapedAt: raw.scrapedAt || new Date().toISOString(),
  };
}
