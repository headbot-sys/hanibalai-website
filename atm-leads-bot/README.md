# ATM Leads Bot

Finds businesses and buildings that appear to want an ATM on site.

Hannibal scans public sources for intent signals like “looking for ATM”,
“need an ATM”, “host an ATM”, and “ATM placement”, then scores and de-dupes
matches into JSON, CSV, and a dashboard page.

## Sources

| Source | Method |
|--------|--------|
| Reddit | Public search JSON (+ news fallback) |
| Google / Bing News | Public RSS |
| Craigslist | Public RSS per metro |
| DuckDuckGo | HTML search results |
| OpenStreetMap | Overpass venue candidates (bars, fuel, laundry…) |

No API keys required for the default set. Be polite: the bot rate-limits
requests and sends an identifying User-Agent.

## Quick start

```bash
cd atm-leads-bot

# Offline sample leads (no network)
npm run start -- demo

# Live scan (all sources)
npm run scan

# Subset of sources / metros
node src/index.js scan --sources=reddit,news --metros=nyc,houston,miami --min-tier=medium

# Rebuild dashboard from stored leads
npm run report
```

Outputs land in `atm-leads-bot/output/`:

- `leads.json` — structured leads
- `leads.csv` — spreadsheet export
- `dashboard.html` — local report

The scan also writes `/atm-leads.html` at the site root for Vercel.

## Intent scoring

Each hit is scored from title + snippet:

- **High** — explicit ask to host / place / need an ATM
- **Medium** — placement / partnership language
- **Low** — weak ATM context
- **Noise** — vendor sales pitches, job posts (often down-ranked/dropped)

## Notes on source availability

Some hosts (Reddit, Craigslist) block datacenter IPs. On a home/office network
the direct scrapers usually work; from cloud VMs the bot falls back to news RSS
mirrors where possible. Always run with `--fresh` after changing scorers.

- Use public endpoints only; follow each site’s terms and robots rules.
- Do not spam contacts pulled from leads.
- For production volume, prefer official APIs (Reddit API, Google CSE, etc.).

## Optional next upgrades

- Google Places proximity (businesses far from known ATMs)
- Email/Telegram digest when a high-intent lead appears
- OpenClaw cron schedule (`0 */6 * * *` → `npm run scan`)
