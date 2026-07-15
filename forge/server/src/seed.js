import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db, audit } from './db.js';
import { id, token } from './util.js';

function wipe() {
  db.exec(`
    DELETE FROM audit_log;
    DELETE FROM alerts;
    DELETE FROM jobs;
    DELETE FROM software;
    DELETE FROM group_members;
    DELETE FROM devices;
    DELETE FROM policies;
    DELETE FROM enrollment_keys;
    DELETE FROM groups;
    DELETE FROM sites;
  `);
}

wipe();

const siteId = id('site');
db.prepare('INSERT INTO sites (id, name) VALUES (?, ?)').run(siteId, 'Hannibal HQ');

const groups = [
  { id: id('grp'), name: 'Workstations', description: 'User laptops and desktops' },
  { id: id('grp'), name: 'Servers', description: 'Infrastructure hosts' },
  { id: id('grp'), name: 'Mac fleet', description: 'Apple macOS devices' },
];
for (const g of groups) {
  db.prepare('INSERT INTO groups (id, site_id, name, description) VALUES (?, ?, ?, ?)').run(
    g.id, siteId, g.name, g.description
  );
}

const enrollKey = `frg_${token(16)}`;
db.prepare(`
  INSERT INTO enrollment_keys (id, site_id, label, key_value)
  VALUES (?, ?, 'Demo enrollment', ?)
`).run(id('ek'), siteId, enrollKey);

db.prepare(`
  INSERT INTO policies (id, site_id, name, description, rules)
  VALUES (?, ?, ?, ?, ?)
`).run(
  id('pol'),
  siteId,
  'Baseline posture',
  'Disk and agent health checks',
  JSON.stringify({
    min_disk_free_pct: 15,
    require_agent_version: '0.1.0',
    heartbeat_max_seconds: 180,
  })
);

const now = new Date();
const minutesAgo = (m) => new Date(now - m * 60_000).toISOString().replace('T', ' ').slice(0, 19);

const demoDevices = [
  {
    hostname: 'mbp-design-01',
    platform: 'darwin',
    os_name: 'macOS',
    os_version: '15.3.1',
    status: 'online',
    last_seen: minutesAgo(0.5),
    ip: '10.0.1.42',
    cpu: 'Apple M3 Pro',
    cores: 12,
    ram: 36,
    disk_total: 512,
    disk_free: 184,
    user: 'ava.chen',
    manufacturer: 'Apple',
    model: 'MacBook Pro',
    serial: 'C02XJ0A7JGH5',
    group: groups[2].id,
    software: [
      { name: 'Google Chrome', version: '131.0.6778.205', publisher: 'Google' },
      { name: 'Slack', version: '4.41.105', publisher: 'Slack Technologies' },
      { name: '1Password', version: '8.10.56', publisher: 'AgileBits' },
      { name: 'Visual Studio Code', version: '1.96.2', publisher: 'Microsoft' },
    ],
  },
  {
    hostname: 'win-ops-14',
    platform: 'windows',
    os_name: 'Windows 11 Pro',
    os_version: '24H2',
    status: 'online',
    last_seen: minutesAgo(1),
    ip: '10.0.1.88',
    cpu: 'Intel Core i7-13700',
    cores: 16,
    ram: 32,
    disk_total: 1024,
    disk_free: 412,
    user: 'marcus.lee',
    manufacturer: 'Dell',
    model: 'OptiPlex 7010',
    serial: '5QZ9K84',
    group: groups[0].id,
    software: [
      { name: 'Microsoft 365 Apps', version: '2411', publisher: 'Microsoft' },
      { name: 'CrowdStrike Falcon', version: '7.18.19106', publisher: 'CrowdStrike' },
      { name: 'Zoom', version: '6.2.6', publisher: 'Zoom Video Communications' },
    ],
  },
  {
    hostname: 'ubuntu-build-03',
    platform: 'linux',
    os_name: 'Ubuntu',
    os_version: '24.04.1 LTS',
    status: 'online',
    last_seen: minutesAgo(0.2),
    ip: '10.0.2.15',
    cpu: 'AMD EPYC 7443P',
    cores: 24,
    ram: 128,
    disk_total: 2048,
    disk_free: 890,
    user: 'ci',
    manufacturer: 'Supermicro',
    model: 'AS-1115S',
    serial: 'SM-882910',
    group: groups[1].id,
    software: [
      { name: 'docker-ce', version: '27.4.1', publisher: 'Docker' },
      { name: 'nginx', version: '1.24.0', publisher: 'nginx' },
      { name: 'nodejs', version: '22.14.0', publisher: 'Node.js' },
    ],
  },
  {
    hostname: 'win-finance-02',
    platform: 'windows',
    os_name: 'Windows 11 Pro',
    os_version: '23H2',
    status: 'offline',
    last_seen: minutesAgo(45),
    ip: '10.0.1.61',
    cpu: 'Intel Core i5-12400',
    cores: 6,
    ram: 16,
    disk_total: 512,
    disk_free: 28,
    user: 'priya.shah',
    manufacturer: 'Lenovo',
    model: 'ThinkCentre M70q',
    serial: 'PC1Y8K2',
    group: groups[0].id,
    software: [
      { name: 'QuickBooks', version: '2024', publisher: 'Intuit' },
      { name: 'Chrome', version: '131.0', publisher: 'Google' },
    ],
  },
  {
    hostname: 'mba-sales-07',
    platform: 'darwin',
    os_name: 'macOS',
    os_version: '14.7.2',
    status: 'online',
    last_seen: minutesAgo(2),
    ip: '10.0.1.103',
    cpu: 'Apple M2',
    cores: 8,
    ram: 16,
    disk_total: 256,
    disk_free: 19,
    user: 'jordan.kim',
    manufacturer: 'Apple',
    model: 'MacBook Air',
    serial: 'FVFH80ABCDEF',
    group: groups[2].id,
    software: [
      { name: 'Salesforce', version: '246.0', publisher: 'Salesforce' },
      { name: 'Notion', version: '4.2.1', publisher: 'Notion Labs' },
    ],
  },
  {
    hostname: 'linux-kiosk-01',
    platform: 'linux',
    os_name: 'Debian',
    os_version: '12',
    status: 'pending',
    last_seen: null,
    ip: '',
    cpu: 'Intel N100',
    cores: 4,
    ram: 8,
    disk_total: 128,
    disk_free: 90,
    user: '',
    manufacturer: 'Protectli',
    model: 'VP2430',
    serial: 'PK-100291',
    group: groups[0].id,
    software: [],
  },
];

const insertDevice = db.prepare(`
  INSERT INTO devices (
    id, site_id, hostname, display_name, platform, os_name, os_version, agent_version,
    enrollment_token, status, last_seen, enrolled_at, ip_address, cpu_model, cpu_cores,
    ram_gb, disk_total_gb, disk_free_gb, logged_in_user, manufacturer, model, serial_number, tags
  ) VALUES (
    ?, ?, ?, ?, ?, ?, ?, '0.1.0', ?, ?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
  )
`);

const insertSoft = db.prepare(`
  INSERT INTO software (device_id, name, version, publisher) VALUES (?, ?, ?, ?)
`);

const inserted = [];

for (const d of demoDevices) {
  const deviceId = id('dev');
  const deviceToken = token(24);
  insertDevice.run(
    deviceId, siteId, d.hostname, d.hostname, d.platform, d.os_name, d.os_version,
    deviceToken, d.status, d.last_seen, d.ip, d.cpu, d.cores, d.ram, d.disk_total,
    d.disk_free, d.user, d.manufacturer, d.model, d.serial,
    JSON.stringify(d.platform === 'darwin' ? ['macos'] : [d.platform])
  );
  db.prepare('INSERT INTO group_members (group_id, device_id) VALUES (?, ?)').run(d.group, deviceId);
  for (const s of d.software) {
    insertSoft.run(deviceId, s.name, s.version, s.publisher);
  }
  inserted.push({ ...d, id: deviceId });
}

const lowDisk = inserted.find((d) => d.hostname === 'mba-sales-07');
const offline = inserted.find((d) => d.hostname === 'win-finance-02');
const build = inserted.find((d) => d.hostname === 'ubuntu-build-03');

db.prepare(`
  INSERT INTO alerts (id, device_id, severity, category, title, message)
  VALUES (?, ?, 'warning', 'storage', 'Disk space warning', ?)
`).run(id('alt'), lowDisk.id, `${lowDisk.hostname} has only ${lowDisk.disk_free} GB free.`);

db.prepare(`
  INSERT INTO alerts (id, device_id, severity, category, title, message)
  VALUES (?, ?, 'critical', 'availability', 'Device offline', ?)
`).run(id('alt'), offline.id, `${offline.hostname} has not checked in for 45 minutes.`);

db.prepare(`
  INSERT INTO jobs (id, device_id, type, title, payload, shell, status, exit_code, stdout, created_at, started_at, completed_at)
  VALUES (?, ?, 'script', 'Disk usage report', 'df -h', 'bash', 'succeeded', 0, ?, datetime('now','-2 hours'), datetime('now','-2 hours'), datetime('now','-2 hours'))
`).run(id('job'), build.id, 'Filesystem      Size  Used Avail Use%\n/dev/sda1       2.0T  1.1T  890G   55%\n');

db.prepare(`
  INSERT INTO jobs (id, device_id, type, title, payload, shell, status, created_at)
  VALUES (?, ?, 'script', 'List logged-in users', 'query user', 'cmd', 'queued', datetime('now'))
`).run(id('job'), offline.id);

audit('system', 'seed', 'site', siteId, 'Demo fleet seeded');

console.log('Forge demo data seeded.');
console.log(`Site: Hannibal HQ (${siteId})`);
console.log(`Enrollment key: ${enrollKey}`);
console.log(`Devices: ${inserted.length}`);
console.log('Console API key: forge-dev-console-key');

const dir = path.dirname(fileURLToPath(import.meta.url));
fs.writeFileSync(
  path.join(dir, '..', 'data', 'demo-credentials.json'),
  JSON.stringify({
    site_id: siteId,
    enrollment_key: enrollKey,
    console_api_key: 'forge-dev-console-key',
    server_url: 'http://localhost:8787',
  }, null, 2)
);
