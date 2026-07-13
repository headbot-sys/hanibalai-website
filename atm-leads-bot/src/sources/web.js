import { INTENT_QUERIES } from '../config.js';
import { leadId, politeFetch, stripHtml } from '../http.js';
import { enrichLead } from '../scorer.js';

const QUERIES = INTENT_QUERIES.slice(0, 5);

/**
 * DuckDuckGo HTML results via POST (GET often returns an empty shell).
 */
export async function scrapeWeb() {
  const leads = [];
  const seen = new Set();

  for (const q of QUERIES) {
    const url = 'https://html.duckduckgo.com/html/';
    try {
      const body = new URLSearchParams({ q });
      const res = await politeFetch(url, {
        method: 'POST',
        headers: {
          Accept: 'text/html',
          'Content-Type': 'application/x-www-form-urlencoded',
          Referer: 'https://duckduckgo.com/',
        },
        body,
      });
      if (!res.ok) {
        console.warn(`[web] ${res.status} for query: ${q}`);
        continue;
      }
      const html = await res.text();

      const linkRe =
        /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      const snippetRe =
        /<(?:a|td)[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|td)>/gi;

      const snippets = [];
      let sn;
      while ((sn = snippetRe.exec(html)) !== null) {
        snippets.push(stripHtml(sn[1] || ''));
      }

      let match;
      let idx = 0;
      while ((match = linkRe.exec(html)) !== null) {
        let href = match[1];
        try {
          const u = new URL(href, 'https://duckduckgo.com');
          const uddg = u.searchParams.get('uddg');
          if (uddg) href = decodeURIComponent(uddg);
          else href = u.toString();
        } catch {
          /* keep href */
        }

        if (!href.startsWith('http') || seen.has(href)) {
          idx += 1;
          continue;
        }
        seen.add(href);

        const title = stripHtml(match[2] || '');
        const snippet = snippets[idx] || '';
        idx += 1;

        const lead = enrichLead({
          id: leadId('web', href, title),
          source: 'web',
          title,
          url: href,
          snippet: snippet.slice(0, 400),
          query: q,
        });
        if (lead.tier !== 'noise') leads.push(lead);
      }
    } catch (err) {
      console.warn(`[web] failed (${q}):`, err.message);
    }
  }

  return leads;
}
