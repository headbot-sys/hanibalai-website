import { INTENT_QUERIES } from '../config.js';
import { leadId, politeFetch, stripHtml } from '../http.js';
import { enrichLead } from '../scorer.js';

const QUERY_BATCH = INTENT_QUERIES.slice(0, 6);

async function scrapeRedditJson({ limit = 25 } = {}) {
  const leads = [];
  const seen = new Set();

  for (const q of QUERY_BATCH) {
    const url =
      `https://www.reddit.com/search.json?q=${encodeURIComponent(q)}` +
      `&sort=new&limit=${Math.min(limit, 25)}&t=year&type=link`;

    try {
      const res = await politeFetch(url, {
        headers: {
          Accept: 'application/json',
        },
      });
      if (!res.ok) {
        console.warn(`[reddit] ${res.status} for query: ${q}`);
        continue;
      }
      const data = await res.json();
      const children = data?.data?.children || [];

      for (const child of children) {
        const d = child.data || {};
        const link = d.url?.startsWith('http')
          ? d.url
          : `https://www.reddit.com${d.permalink || ''}`;
        if (!link || seen.has(link)) continue;
        seen.add(link);

        const title = d.title || '';
        const snippet = stripHtml(d.selftext || d.link_flair_text || '').slice(0, 400);
        const lead = enrichLead({
          id: leadId('reddit', link, title),
          source: 'reddit',
          title,
          url: link,
          snippet,
          location: d.subreddit_name_prefixed || null,
          author: d.author || null,
          query: q,
        });
        if (lead.tier !== 'noise') leads.push(lead);
      }
    } catch (err) {
      console.warn(`[reddit] failed (${q}):`, err.message);
    }
  }

  return leads;
}

/**
 * When Reddit JSON is blocked (common on datacenter IPs), fall back to
 * Bing/Google news RSS filtered to reddit.com discussions.
 */
async function scrapeRedditViaNews() {
  const leads = [];
  const seen = new Set();
  const queries = [
    'site:reddit.com "looking for ATM" OR "need an ATM" OR "host an ATM"',
    'site:reddit.com "ATM placement" OR "ATM for my" (store OR bar OR restaurant)',
  ];

  for (const q of queries) {
    const urls = [
      `https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss`,
      `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`,
    ];
    for (const feed of urls) {
      try {
        const res = await politeFetch(feed);
        if (!res.ok) continue;
        const xml = await res.text();
        const chunks = xml.split(/<item[\s>]/i).slice(1);
        for (const chunk of chunks) {
          const title = stripHtml((chunk.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
          const link = stripHtml((chunk.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || [])[1] || '');
          const desc = stripHtml(
            (chunk.match(/<description[^>]*>([\s\S]*?)<\/description>/i) || [])[1] || ''
          );
          if (!link || seen.has(link)) continue;
          seen.add(link);
          const lead = enrichLead({
            id: leadId('reddit', link, title),
            source: 'reddit',
            title,
            url: link,
            snippet: desc.slice(0, 400),
            query: q,
          });
          if (lead.tier !== 'noise') leads.push(lead);
        }
      } catch (err) {
        console.warn(`[reddit:news-fallback] ${err.message}`);
      }
    }
  }
  return leads;
}

/**
 * Reddit public search JSON, with news/RSS fallback if blocked.
 */
export async function scrapeReddit(options = {}) {
  const primary = await scrapeRedditJson(options);
  if (primary.length) return primary;
  console.warn('[reddit] direct API empty/blocked — trying news fallback…');
  return scrapeRedditViaNews();
}
