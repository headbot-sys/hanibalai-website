# Forge — Workstation Management (RMM / MDM)

Forge is a Datto RMM / Jamf–style workstation management platform: enroll endpoints, monitor fleet health, collect inventory, push remote scripts, and triage alerts from a single console.

Built as an open, self-hosted MVP by **Hannibal AI**.

## What's included

| Component | Path | Role |
|-----------|------|------|
| **Server** | `server/` | REST API, SQLite store, policy & job queue |
| **Agent** | `agent/forge_agent.py` | Cross-platform Python agent |
| **Windows agent** | `agent/windows/` | PowerShell agent + silent installer (download link) |
| **Console** | `console/` | Admin web UI for fleet operations |

### Capabilities

- **Device enrollment** via enrollment keys (site-scoped)
- **Live status** — online / offline / pending from heartbeats
- **Hardware & OS inventory** — CPU, RAM, disk, serial, logged-in user
- **Software inventory** sync from agents
- **Remote script jobs** — queue bash / cmd / PowerShell; agents execute on next poll
- **Alerts** — low disk, offline hosts, failed jobs (ack workflow)
- **Groups & sites** for organizing the fleet
- **Baseline policies** delivered to agents on heartbeat
- **Audit log** of console and agent actions

## Quick start

### 1. Install & seed

```bash
cd forge
npm install
npm run install:all
npm run seed
```

Seed prints the **enrollment key** and writes `server/data/demo-credentials.json`. Demo fleet data is loaded so the console is usable immediately.

### 2. Run (dev)

```bash
# Terminal A — API (port 8787)
npm run dev:server

# Terminal B — Console (port 5173, proxies /api)
npm run dev:console
```

Open **http://localhost:5173**

Default console API key: `forge-dev-console-key` (header `X-Api-Key`).

Or from `forge/`:

```bash
npm install
npm run install:all
npm run seed
npm run dev   # both server + console via concurrently
```

### 3. Enroll a Windows PC (silent — no App Store)

From **Enrollment** in the console, copy the install command, or:

```powershell
# Elevated PowerShell
iex (irm 'http://YOUR_SERVER:8787/download/windows-agent.ps1?key=YOUR_KEY')
```

Links:

- Metadata: `GET /download/windows-agent?key=...`
- Silent installer script: `GET /download/windows-agent.ps1?key=...`
- Agent script only: `GET /download/forge_agent.ps1`

Installs to `Program Files\ForgeAgent` and registers scheduled task `ForgeAgent` (runs at startup as SYSTEM).

### 4. Enroll Mac / Linux (Python agent)

```bash
cd agent
python3 forge_agent.py enroll \
  --server http://YOUR_SERVER:8787 \
  --key <enrollment_key_from_seed_or_console>

python3 forge_agent.py run
```

Useful one-shots:

```bash
python3 forge_agent.py info        # local inventory JSON
python3 forge_agent.py heartbeat   # single check-in
python3 forge_agent.py inventory   # push software list
```

### 4. Production-ish single process

```bash
npm run build          # builds console into console/dist
npm start              # server serves API + static console on :8787
```

## API overview

### Console (`X-Api-Key` required)

- `GET /api/v1/console/dashboard`
- `GET/PATCH/DELETE /api/v1/console/devices[/:id]`
- `GET/POST /api/v1/console/jobs`
- `GET /api/v1/console/alerts` · `POST .../ack`
- `GET/POST /api/v1/console/groups`
- `GET/POST /api/v1/console/enrollment-keys`
- `GET/POST /api/v1/console/policies`

### Agent

- `POST /api/v1/agent/enroll`
- `POST /api/v1/agent/heartbeat` — headers `X-Device-Id`, `X-Device-Token`
- `POST /api/v1/agent/inventory`
- `POST /api/v1/agent/jobs/:id/result`

## Architecture

```
┌─────────────┐  enroll / heartbeat / jobs   ┌──────────────────┐
│ Forge Agent │ ───────────────────────────► │   Forge Server   │
│  (Python)   │ ◄─────────────────────────── │  Express+SQLite  │
└─────────────┘   queued scripts + policies  └────────┬─────────┘
                                                      │
                                             ┌────────▼─────────┐
                                             │  Forge Console   │
                                             │   (Vite SPA)     │
                                             └──────────────────┘
```

Agents poll on heartbeat (~30s). Jobs sit in `queued` until claimed, then agents report stdout/stderr.

## Configuration

| Env var | Default | Meaning |
|---------|---------|---------|
| `PORT` | `8787` | Server listen port |
| `FORGE_CONSOLE_KEY` | `forge-dev-console-key` | Console API key |
| `FORGE_DB` | `server/data/forge.db` | SQLite path |

## Roadmap (not in this MVP)

- Push package deploy / patch management
- MDM profiles (FileVault, Configuration Profiles, Windows CSP)
- Real-time tunnels (interactive remote shell / screen)
- RBAC multi-admin SSO
- Auto-update agent packages (msi / pkg / deb)

## License

Private — Hannibal AI.
