import { METROS } from '../config.js';
import { leadId, politeFetch, stripHtml } from '../http.js';
import { enrichLead } from '../scorer.js';

const SEARCH_TERMS = ['ATM', 'ATM placement', 'need ATM', 'host ATM'];

function parseRssItems(xml) {
  const items = [];
  const chunks = xml.split(/<item[\s>]/i).slice(1);
  for (const chunk of chunks) {
    const title = stripHtml((chunk.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
    const link = stripHtml((chunk.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || [])[1] || '');
    const desc = stripHtml(
      (chunk.match(/<description[^>]*>([\s\S]*?)<\/description>/i) || [])[1] || ''
    );
    if (title || link) items.push({ title, link, desc });
  }
  return items;
}

/**
 * Craigslist RSS search — public feeds per metro.
 * Focuses on business-oriented sections (bfw = business/financial, gigs, etc.).
 */
export async function scrapeCraigslist({ metros = METROS } = {}) {
  const leads = [];
  const seen = new Set();

  for (const metro of metros) {
    for (const term of SEARCH_TERMS) {
      const url =
        `https://${metro.craigslist}.craigslist.org/search/bbb` +
        `?format=rss&query=${encodeURIComponent(term)}`;

      try {
        const res = await politeFetch(url);
        if (!res.ok) {
          console.warn(`[craigslist] ${res.status} ${metro.name} / ${term}`);
          continue;
        }
        const xml = await res.text();
        for (const item of parseRssItems(xml)) {
          if (!item.link || seen.has(item.link)) continue;
          // Craigslist often lists ATM *sales* — scorer downranks vendors.
          if (!/\batm\b/i.test(`${item.title} ${item.desc}`)) continue;
          seen.add(item.link);

          const lead = enrichLead({
            id: leadId('craigslist', item.link, item.title),
            source: 'craigslist',
            title: item.title,
            url: item.link,
            snippet: item.desc.slice(0, 400),
            location: metro.name,
            query: term,
          });
          if (lead.tier !== 'noise') leads.push(lead);
        }
      } catch (err) {
        console.warn(`[craigslist] failed (${metro.name}):`, err.message);
      }
    }
  }

  return leads;
}
