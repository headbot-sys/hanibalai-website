import { leadId, politeFetch, stripHtml } from '../http.js';
import { enrichLead } from '../scorer.js';

/** Targeted queries with crime/noise exclusions for public news RSS. */
const QUERIES = [
  '"looking for ATM" OR "need an ATM" OR "host an ATM" -theft -skimmer -robbery -stolen',
  '"ATM placement" (business OR store OR restaurant OR bar) -theft -skimmer',
  '"ATM free location" OR "place an ATM" OR "hosting an ATM"',
  'ATM operator wanted retail OR laundromat OR gas station',
];

function parseRssItems(xml) {
  const items = [];
  const chunks = xml.split(/<item[\s>]/i).slice(1);
  for (const chunk of chunks) {
    const title = stripHtml((chunk.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
    const link = stripHtml((chunk.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || [])[1] || '');
    const desc = stripHtml(
      (chunk.match(/<description[^>]*>([\s\S]*?)<\/description>/i) || [])[1] || ''
    );
    const pubDate = stripHtml((chunk.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i) || [])[1] || '');
    if (title || link) items.push({ title, link, desc, pubDate });
  }
  return items;
}

async function fetchRss(source, url, query) {
  const leads = [];
  const res = await politeFetch(url);
  if (!res.ok) {
    console.warn(`[${source}] ${res.status} for query: ${query}`);
    return leads;
  }
  const xml = await res.text();
  for (const item of parseRssItems(xml)) {
    if (!item.link) continue;
    const lead = enrichLead({
      id: leadId(source, item.link, item.title),
      source,
      title: item.title,
      url: item.link,
      snippet: item.desc.slice(0, 400),
      publishedAt: item.pubDate || null,
      query,
    });
    if (lead.tier !== 'noise') leads.push(lead);
  }
  return leads;
}

/**
 * Google News + Bing News RSS (no API keys).
 * @param {{ places?: string[] }} [opts]
 */
export async function scrapeNews({ places = [] } = {}) {
  const leads = [];
  const seen = new Set();

  const queries = [...QUERIES];
  for (const place of places) {
    queries.push(
      `"ATM" (${place}) (placement OR host OR "looking for" OR "need an") -theft -skimmer`,
      `ATM placement OR "host an ATM" OR "need an ATM" ${place}`
    );
  }

  for (const q of queries) {
    const googleUrl =
      `https://news.google.com/rss/search?q=${encodeURIComponent(q)}` +
      `&hl=en-US&gl=US&ceid=US:en`;
    const bingUrl = `https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss`;

    try {
      for (const lead of await fetchRss('news', googleUrl, q)) {
        if (seen.has(lead.url)) continue;
        seen.add(lead.url);
        if (places.length) {
          lead.location = lead.location || places[0];
        }
        leads.push(lead);
      }
    } catch (err) {
      console.warn(`[news:google] failed (${q}):`, err.message);
    }

    try {
      for (const lead of await fetchRss('bing-news', bingUrl, q)) {
        if (seen.has(lead.url)) continue;
        seen.add(lead.url);
        if (places.length) {
          lead.location = lead.location || places[0];
        }
        leads.push(lead);
      }
    } catch (err) {
      console.warn(`[news:bing] failed (${q}):`, err.message);
    }
  }

  return leads;
}
