import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const OUTPUT_DIR = path.resolve(__dirname, '../output');
export const LEADS_JSON = path.join(OUTPUT_DIR, 'leads.json');
export const LEADS_CSV = path.join(OUTPUT_DIR, 'leads.csv');

export async function ensureOutputDir() {
  await mkdir(OUTPUT_DIR, { recursive: true });
}

export async function loadLeads() {
  try {
    const raw = await readFile(LEADS_JSON, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data.leads) ? data.leads : [];
  } catch {
    return [];
  }
}

export function mergeLeads(existing, incoming) {
  const byId = new Map();
  for (const lead of existing) byId.set(lead.id, lead);
  for (const lead of incoming) {
    const prev = byId.get(lead.id);
    if (!prev || (lead.score ?? 0) >= (prev.score ?? 0)) {
      byId.set(lead.id, { ...prev, ...lead, firstSeen: prev?.firstSeen || lead.scrapedAt });
    }
  }
  return [...byId.values()].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

function csvEscape(value) {
  const s = value == null ? '' : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function saveLeads(leads) {
  await ensureOutputDir();
  const payload = {
    generatedAt: new Date().toISOString(),
    count: leads.length,
    leads,
  };
  await writeFile(LEADS_JSON, JSON.stringify(payload, null, 2));

  const headers = [
    'id',
    'tier',
    'score',
    'title',
    'source',
    'location',
    'url',
    'snippet',
    'scrapedAt',
  ];
  const lines = [headers.join(',')];
  for (const lead of leads) {
    lines.push(
      headers
        .map((h) => csvEscape(Array.isArray(lead[h]) ? lead[h].join('; ') : lead[h]))
        .join(',')
    );
  }
  await writeFile(LEADS_CSV, lines.join('\n'));
  return payload;
}
