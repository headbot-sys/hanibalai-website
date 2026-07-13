import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { DEFAULT_SOURCES, METROS } from './config.js';
import { scrapeReddit } from './sources/reddit.js';
import { scrapeNews } from './sources/news.js';
import { scrapeCraigslist } from './sources/craigslist.js';
import { scrapeWeb } from './sources/web.js';
import { OSM_AREAS, scrapeOsmCandidates } from './sources/osm.js';
import { loadLeads, mergeLeads, saveLeads, OUTPUT_DIR, ensureOutputDir } from './store.js';
import { generateDashboardHtml } from './report.js';
import { DEMO_LEADS } from './demo-leads.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function printHelp() {
  console.log(`
ATM Leads Bot — find businesses / buildings that want an ATM

Usage:
  node src/index.js scan [options]
  node src/index.js report
  node src/index.js demo

Options:
  --sources=reddit,news,craigslist,web,osm   Comma list (default: all)
  --metros=austin,houston,dallas             Limit Craigslist + OSM + localized news
  --min-tier=low|medium|high                 Filter saved output (default: low)
  --fresh                                    Replace stored leads instead of merging
  --demo                                     Seed with sample leads (no network)

Examples:
  npm run scan
  node src/index.js scan --metros=austin --sources=osm,news,craigslist --fresh
  node src/index.js demo
`);
}

function parseArgs(argv) {
  const args = {
    command: 'scan',
    sources: DEFAULT_SOURCES,
    metros: METROS,
    metrosFiltered: false,
    minTier: 'low',
    demo: false,
    fresh: false,
  };
  const positionals = [];

  for (const a of argv) {
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--demo') args.demo = true;
    else if (a === '--fresh') args.fresh = true;
    else if (a.startsWith('--sources=')) {
      args.sources = a
        .slice('--sources='.length)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (a.startsWith('--metros=')) {
      const ids = a
        .slice('--metros='.length)
        .split(',')
        .map((s) => s.trim().toLowerCase());
      args.metros = METROS.filter(
        (m) => ids.includes(m.id) || ids.includes(m.craigslist) || ids.includes(m.name.toLowerCase())
      );
      args.metrosFiltered = true;
    } else if (a.startsWith('--min-tier=')) {
      args.minTier = a.slice('--min-tier='.length).toLowerCase();
    } else if (!a.startsWith('-')) {
      positionals.push(a);
    }
  }

  if (positionals[0]) args.command = positionals[0];
  return args;
}

function osmAreasForMetros(metros, filtered) {
  if (!filtered) return OSM_AREAS;
  const names = new Set(metros.map((m) => m.name.toLowerCase()));
  return OSM_AREAS.filter((a) => names.has(a.name.toLowerCase()));
}

const TIER_RANK = { noise: 0, low: 1, medium: 2, high: 3 };

async function runScan(args) {
  console.log('🐘 ATM Leads Bot — scanning public sources…');
  console.log(`   Sources: ${args.sources.join(', ')}`);
  if (args.metrosFiltered) {
    console.log(`   Metros: ${args.metros.map((m) => m.name).join(', ')}`);
  }

  let found = [];
  const places = args.metrosFiltered ? args.metros.map((m) => m.name) : [];

  if (args.demo || args.command === 'demo') {
    console.log('   Mode: demo (sample leads)');
    found = DEMO_LEADS.map((l) => ({ ...l, scrapedAt: new Date().toISOString() }));
  } else {
    if (args.sources.includes('reddit')) {
      process.stdout.write('   → Reddit… ');
      const r = await scrapeReddit({ places });
      console.log(`${r.length} hits`);
      found.push(...r);
    }
    if (args.sources.includes('news')) {
      process.stdout.write('   → News RSS… ');
      const n = await scrapeNews({ places });
      console.log(`${n.length} hits`);
      found.push(...n);
    }
    if (args.sources.includes('craigslist')) {
      process.stdout.write(`   → Craigslist (${args.metros.length} metros)… `);
      const c = await scrapeCraigslist({ metros: args.metros });
      console.log(`${c.length} hits`);
      found.push(...c);
    }
    if (args.sources.includes('web')) {
      process.stdout.write('   → DuckDuckGo… ');
      const w = await scrapeWeb({ places });
      console.log(`${w.length} hits`);
      found.push(...w);
    }
    if (args.sources.includes('osm')) {
      const areas = osmAreasForMetros(args.metros, args.metrosFiltered);
      process.stdout.write(`   → OpenStreetMap venues (${areas.map((a) => a.name).join(', ') || 'default'})… `);
      const o = await scrapeOsmCandidates({ areas: areas.length ? areas : OSM_AREAS });
      console.log(`${o.length} hits`);
      found.push(...o);
    }
  }

  const minRank = TIER_RANK[args.minTier] ?? 1;
  found = found.filter((l) => (TIER_RANK[l.tier] ?? 0) >= minRank);

  const existing = args.fresh ? [] : await loadLeads();
  // Drop previous demo placeholders when doing a live fresh/replace merge.
  const cleanedExisting = existing.filter((l) => !String(l.id || '').startsWith('demo-'));
  const merged = mergeLeads(args.fresh ? [] : cleanedExisting, found);
  const saved = await saveLeads(merged);

  await writeDashboard(merged);

  console.log(`\nSaved ${saved.count} leads → ${path.relative(process.cwd(), OUTPUT_DIR)}/`);
  console.log('  leads.json  leads.csv  dashboard.html');

  const top = merged.filter((l) => l.tier === 'high' || l.tier === 'medium').slice(0, 8);
  if (top.length) {
    console.log('\nTop leads:');
    for (const lead of top) {
      console.log(`  [${lead.tier}/${lead.score}] ${lead.title}`);
      console.log(`     ${lead.url}`);
    }
  } else {
    console.log('\nNo medium/high-intent leads this run. Try --demo or widen --min-tier=low.');
  }
}

async function writeDashboard(leads) {
  await ensureOutputDir();
  const html = generateDashboardHtml(leads);
  const out = path.join(OUTPUT_DIR, 'dashboard.html');
  await writeFile(out, html);
  // Also copy into website public path for Vercel static serve
  const siteDash = path.resolve(__dirname, '../../atm-leads.html');
  await writeFile(siteDash, html);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  if (args.command === 'report') {
    const leads = await loadLeads();
    await writeDashboard(leads);
    console.log(`Dashboard refreshed from ${leads.length} stored leads.`);
    return;
  }

  if (args.command === 'demo' || args.demo) {
    args.demo = true;
    await runScan(args);
    return;
  }

  if (args.command === 'scan' || args.command === 'run') {
    await runScan(args);
    return;
  }

  printHelp();
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
