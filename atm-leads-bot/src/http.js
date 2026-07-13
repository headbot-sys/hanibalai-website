import { setTimeout as sleep } from 'node:timers/promises';
import { REQUEST_DELAY_MS, REQUEST_TIMEOUT_MS, USER_AGENT } from './config.js';

let lastRequestAt = 0;

export async function politeFetch(url, options = {}) {
  const now = Date.now();
  const wait = Math.max(0, REQUEST_DELAY_MS - (now - lastRequestAt));
  if (wait) await sleep(wait);
  lastRequestAt = Date.now();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json, text/html, application/rss+xml, */*',
        ...(options.headers || {}),
      },
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

export function stripHtml(html = '') {
  // Decode common entities first so encoded tags can be stripped.
  const decoded = String(html)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));

  return decoded
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeUrl(url = '') {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.toString();
  } catch {
    return url;
  }
}

export function leadId(source, url, title) {
  const key = `${source}|${normalizeUrl(url)}|${(title || '').toLowerCase().slice(0, 80)}`;
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return `${source}-${hash.toString(16)}`;
}
