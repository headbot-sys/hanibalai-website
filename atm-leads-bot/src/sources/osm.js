import { leadId, politeFetch } from '../http.js';
import { setTimeout as sleep } from 'node:timers/promises';

/** City centers used for Overpass “around” queries (lat, lon, radius meters). */
export const OSM_AREAS = [
  { name: 'Austin', lat: 30.2672, lon: -97.7431, radius: 14000 },
  { name: 'Houston', lat: 29.7604, lon: -95.3698, radius: 12000 },
  { name: 'Dallas', lat: 32.7767, lon: -96.797, radius: 10000 },
  { name: 'Miami', lat: 25.7617, lon: -80.1918, radius: 10000 },
  { name: 'Chicago', lat: 41.8781, lon: -87.6298, radius: 10000 },
  { name: 'Atlanta', lat: 33.749, lon: -84.388, radius: 10000 },
];

/** Cash-heavy venue types that commonly host ATMs. */
const TAGS = [
  'node["amenity"="bar"]',
  'node["amenity"="nightclub"]',
  'node["amenity"="fuel"]',
  'node["shop"="laundry"]',
  'node["shop"="convenience"]',
  'node["amenity"="casino"]',
  'node["shop"="tobacco"]',
];

function buildQuery(area) {
  const unions = TAGS.map(
    (tag) => `  ${tag}(around:${area.radius},${area.lat},${area.lon});`
  ).join('\n');

  return `
[out:json][timeout:45];
(
${unions}
);
out body 120;
`.trim();
}

/**
 * OpenStreetMap Overpass — free, no API key.
 * Surfaces bars, fuel stations, laundromats, etc. as ATM placement candidates.
 */
export async function scrapeOsmCandidates({ areas = OSM_AREAS, perArea = 40 } = {}) {
  const leads = [];
  const seen = new Set();
  const endpoint = 'https://overpass-api.de/api/interpreter';

  for (const area of areas) {
    const query = buildQuery(area);
    try {
      const res = await politeFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ data: query }),
      });
      if (!res.ok) {
        console.warn(`[osm] ${res.status} for ${area.name}`);
        continue;
      }
      const data = await res.json();
      const elements = (data.elements || [])
        .filter((el) => el.tags?.name)
        .slice(0, perArea);

      for (const el of elements) {
        const name = el.tags.name;
        const kind = el.tags.amenity || el.tags.shop || 'venue';
        const key = `${area.name}|${name}|${el.id}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const mapUrl = `https://www.openstreetmap.org/node/${el.id}`;
        const address = [el.tags['addr:housenumber'], el.tags['addr:street'], el.tags['addr:city']]
          .filter(Boolean)
          .join(' ');
        const title = `${name} — potential ATM host (${kind})`;
        const snippet =
          `${kind} in ${area.name}` +
          (address ? ` · ${address}` : '') +
          '. Cash-heavy venue type often suited for ATM placement. Confirm interest before outreach.';

        leads.push({
          id: leadId('osm', mapUrl, title),
          source: 'osm',
          title,
          url: mapUrl,
          snippet,
          location: area.name,
          latitude: el.lat,
          longitude: el.lon,
          venueType: kind,
          score: 40,
          tier: 'medium',
          reasons: ['candidate:cash-heavy-venue'],
          query: `osm:${kind}`,
          scrapedAt: new Date().toISOString(),
        });
      }
    } catch (err) {
      console.warn(`[osm] failed (${area.name}):`, err.message);
    }
    await sleep(1500);
  }

  return leads;
}
