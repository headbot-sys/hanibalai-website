/**
 * Build a standalone HTML dashboard of ATM placement leads.
 */
export function generateDashboardHtml(leads = []) {
  const usable = leads.filter((l) => l.tier !== 'noise');
  const high = usable.filter((l) => l.tier === 'high').length;
  const medium = usable.filter((l) => l.tier === 'medium').length;
  const generatedAt = new Date().toISOString();

  const rows = usable
    .map((lead) => {
      const tierClass = `tier-${lead.tier || 'low'}`;
      const loc = escapeHtml(lead.location || '—');
      const title = escapeHtml(lead.title || 'Untitled');
      const snippet = escapeHtml((lead.snippet || '').slice(0, 220));
      const source = escapeHtml(lead.source || '');
      const url = escapeAttr(lead.url || '#');
      return `
        <article class="lead ${tierClass}">
          <header>
            <span class="badge">${escapeHtml(lead.tier)} · ${lead.score ?? 0}</span>
            <span class="meta">${source} · ${loc}</span>
          </header>
          <h3><a href="${url}" target="_blank" rel="noopener noreferrer">${title}</a></h3>
          <p>${snippet}</p>
        </article>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>ATM Leads — Hannibal</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;700&family=Source+Sans+3:wght@400;600&display=swap" rel="stylesheet" />
  <style>
    :root {
      --bg0: #0a0a0f;
      --bg1: #12121a;
      --line: #2a2a3a;
      --gold: #d4a843;
      --ink: #f0e6cc;
      --muted: rgba(240, 230, 204, 0.68);
      --high: #3d9a6a;
      --medium: #c4a035;
      --low: #6b6b7a;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      color: var(--ink);
      font-family: "Source Sans 3", sans-serif;
      background:
        radial-gradient(1200px 600px at 10% -10%, rgba(212, 168, 67, 0.16), transparent 55%),
        radial-gradient(900px 500px at 100% 0%, rgba(61, 154, 106, 0.1), transparent 50%),
        linear-gradient(180deg, #0c0c14 0%, var(--bg0) 45%, #0b0d12 100%);
    }
    nav {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 22px 48px;
      border-bottom: 1px solid var(--line);
    }
    .logo {
      font-family: "Cormorant Garamond", serif;
      letter-spacing: 0.18em;
      color: var(--gold);
      font-size: 1.25rem;
      font-weight: 700;
      text-decoration: none;
    }
    nav a { color: var(--muted); text-decoration: none; margin-left: 24px; font-size: 0.92rem; }
    nav a:hover { color: var(--ink); }
    .hero {
      padding: 72px 48px 40px;
      max-width: 1100px;
      margin: 0 auto;
      animation: rise 0.7s ease-out both;
    }
    h1 {
      font-family: "Cormorant Garamond", serif;
      font-size: clamp(2.4rem, 5vw, 3.6rem);
      color: var(--gold);
      letter-spacing: 0.06em;
      margin-bottom: 12px;
    }
    .hero p {
      max-width: 640px;
      color: var(--muted);
      line-height: 1.7;
      font-size: 1.05rem;
    }
    .stats {
      display: flex;
      gap: 28px;
      flex-wrap: wrap;
      margin-top: 28px;
      animation: rise 0.8s 0.1s ease-out both;
    }
    .stat strong {
      display: block;
      font-family: "Cormorant Garamond", serif;
      font-size: 2rem;
      color: var(--gold);
    }
    .stat span { color: var(--muted); font-size: 0.85rem; letter-spacing: 0.04em; }
    .toolbar {
      max-width: 1100px;
      margin: 0 auto;
      padding: 0 48px 20px;
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      animation: rise 0.8s 0.15s ease-out both;
    }
    .chip {
      border: 1px solid var(--line);
      background: transparent;
      color: var(--muted);
      padding: 8px 14px;
      border-radius: 999px;
      cursor: pointer;
      font: inherit;
    }
    .chip.active, .chip:hover {
      border-color: var(--gold);
      color: var(--gold);
    }
    .feed {
      max-width: 1100px;
      margin: 0 auto;
      padding: 12px 48px 80px;
      display: grid;
      gap: 16px;
      animation: rise 0.9s 0.2s ease-out both;
    }
    .lead {
      background: rgba(18, 18, 26, 0.88);
      border: 1px solid var(--line);
      border-left: 3px solid var(--low);
      border-radius: 4px;
      padding: 22px 24px;
      transition: border-color 0.2s, transform 0.2s;
    }
    .lead:hover { border-color: rgba(212, 168, 67, 0.55); transform: translateY(-1px); }
    .lead.tier-high { border-left-color: var(--high); }
    .lead.tier-medium { border-left-color: var(--medium); }
    .lead.tier-low { border-left-color: var(--low); }
    .lead header {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 10px;
    }
    .badge {
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-size: 0.72rem;
      color: var(--gold);
      border: 1px solid rgba(212, 168, 67, 0.35);
      padding: 4px 8px;
    }
    .meta { color: var(--muted); font-size: 0.85rem; }
    .lead h3 { font-size: 1.15rem; margin-bottom: 8px; font-weight: 600; }
    .lead h3 a { color: var(--ink); text-decoration: none; }
    .lead h3 a:hover { color: var(--gold); }
    .lead p { color: var(--muted); line-height: 1.65; font-size: 0.95rem; }
    .empty { color: var(--muted); padding: 40px 0; }
    footer {
      border-top: 1px solid var(--line);
      text-align: center;
      padding: 28px;
      color: rgba(240, 230, 204, 0.4);
      font-size: 0.82rem;
    }
    @keyframes rise {
      from { opacity: 0; transform: translateY(12px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @media (max-width: 700px) {
      nav, .hero, .toolbar, .feed { padding-left: 22px; padding-right: 22px; }
      .hero { padding-top: 48px; }
    }
  </style>
</head>
<body>
  <nav>
    <a class="logo" href="/">HANNIBAL</a>
    <div>
      <a href="/">Home</a>
      <a href="/atm-leads.html">ATM Leads</a>
      <a href="mailto:headbot@hanibalai.com">Contact</a>
    </div>
  </nav>

  <section class="hero">
    <h1>ATM Leads</h1>
    <p>
      Live scan of public signals — Reddit, news, Craigslist, and web search —
      for businesses and buildings that look like they want an ATM on site.
      Generated ${escapeHtml(generatedAt)}.
    </p>
    <div class="stats">
      <div class="stat"><strong>${usable.length}</strong><span>QUALIFIED LEADS</span></div>
      <div class="stat"><strong>${high}</strong><span>HIGH INTENT</span></div>
      <div class="stat"><strong>${medium}</strong><span>MEDIUM INTENT</span></div>
    </div>
  </section>

  <div class="toolbar">
    <button class="chip active" data-filter="all">All</button>
    <button class="chip" data-filter="high">High</button>
    <button class="chip" data-filter="medium">Medium</button>
    <button class="chip" data-filter="low">Low</button>
  </div>

  <section class="feed" id="feed">
    ${rows || '<p class="empty">No leads yet. Run <code>npm run scan</code> inside <code>atm-leads-bot</code>.</p>'}
  </section>

  <footer>© 2026 Hannibal AI · ATM Leads Bot · Public sources only · Respect site terms when scraping</footer>

  <script>
    const chips = document.querySelectorAll('.chip');
    const leads = document.querySelectorAll('.lead');
    chips.forEach((chip) => {
      chip.addEventListener('click', () => {
        chips.forEach((c) => c.classList.remove('active'));
        chip.classList.add('active');
        const f = chip.dataset.filter;
        leads.forEach((el) => {
          const show = f === 'all' || el.classList.contains('tier-' + f);
          el.style.display = show ? '' : 'none';
        });
      });
    });
  </script>
</body>
</html>`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, '&#39;');
}
