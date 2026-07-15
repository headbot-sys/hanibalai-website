import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = process.env.FORGE_DB || path.join(dataDir, 'forge.db');
export const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS sites (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS groups (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    hostname TEXT NOT NULL,
    display_name TEXT,
    platform TEXT NOT NULL DEFAULT 'unknown',
    os_name TEXT DEFAULT '',
    os_version TEXT DEFAULT '',
    agent_version TEXT DEFAULT '',
    enrollment_token TEXT UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending',
    last_seen TEXT,
    enrolled_at TEXT,
    ip_address TEXT DEFAULT '',
    mac_address TEXT DEFAULT '',
    cpu_model TEXT DEFAULT '',
    cpu_cores INTEGER DEFAULT 0,
    ram_gb REAL DEFAULT 0,
    disk_total_gb REAL DEFAULT 0,
    disk_free_gb REAL DEFAULT 0,
    uptime_seconds INTEGER DEFAULT 0,
    logged_in_user TEXT DEFAULT '',
    manufacturer TEXT DEFAULT '',
    model TEXT DEFAULT '',
    serial_number TEXT DEFAULT '',
    tags TEXT DEFAULT '[]',
    metadata TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS group_members (
    group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    PRIMARY KEY (group_id, device_id)
  );

  CREATE TABLE IF NOT EXISTS software (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    version TEXT DEFAULT '',
    publisher TEXT DEFAULT '',
    install_date TEXT DEFAULT '',
    UNIQUE(device_id, name, version)
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    type TEXT NOT NULL DEFAULT 'script',
    title TEXT NOT NULL DEFAULT '',
    payload TEXT NOT NULL DEFAULT '',
    shell TEXT DEFAULT 'auto',
    timeout_seconds INTEGER DEFAULT 300,
    status TEXT NOT NULL DEFAULT 'queued',
    exit_code INTEGER,
    stdout TEXT DEFAULT '',
    stderr TEXT DEFAULT '',
    created_by TEXT DEFAULT 'console',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    started_at TEXT,
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS alerts (
    id TEXT PRIMARY KEY,
    device_id TEXT REFERENCES devices(id) ON DELETE CASCADE,
    severity TEXT NOT NULL DEFAULT 'warning',
    category TEXT NOT NULL DEFAULT 'system',
    title TEXT NOT NULL,
    message TEXT NOT NULL DEFAULT '',
    acknowledged INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    acknowledged_at TEXT
  );

  CREATE TABLE IF NOT EXISTS policies (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    rules TEXT NOT NULL DEFAULT '{}',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor TEXT NOT NULL DEFAULT 'system',
    action TEXT NOT NULL,
    target_type TEXT DEFAULT '',
    target_id TEXT DEFAULT '',
    detail TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS enrollment_keys (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    label TEXT NOT NULL DEFAULT 'Default',
    key_value TEXT NOT NULL UNIQUE,
    max_uses INTEGER DEFAULT 0,
    use_count INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    revoked INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_devices_site ON devices(site_id);
  CREATE INDEX IF NOT EXISTS idx_devices_status ON devices(status);
  CREATE INDEX IF NOT EXISTS idx_jobs_device_status ON jobs(device_id, status);
  CREATE INDEX IF NOT EXISTS idx_alerts_ack ON alerts(acknowledged);
  CREATE INDEX IF NOT EXISTS idx_software_device ON software(device_id);
`);

export function audit(actor, action, targetType = '', targetId = '', detail = '') {
  db.prepare(`
    INSERT INTO audit_log (actor, action, target_type, target_id, detail)
    VALUES (?, ?, ?, ?, ?)
  `).run(actor, action, targetType, targetId, detail);
}
