import { Router } from 'express';
import { db, audit } from './db.js';
import { id, token, parseJson, devicePayload, refreshDeviceStatuses, evaluateAlerts } from './util.js';

export const consoleRouter = Router();
export const agentRouter = Router();

const CONSOLE_API_KEY = process.env.FORGE_CONSOLE_KEY || 'forge-dev-console-key';

function requireConsole(req, res, next) {
  const key = req.header('x-api-key') || req.query.api_key;
  if (key !== CONSOLE_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

consoleRouter.use(requireConsole);

/* ─── Dashboard ─────────────────────────────────────────── */

consoleRouter.get('/dashboard', (_req, res) => {
  refreshDeviceStatuses(db);
  const devices = db.prepare('SELECT status, platform FROM devices').all();
  const online = devices.filter((d) => d.status === 'online').length;
  const offline = devices.filter((d) => d.status === 'offline').length;
  const pending = devices.filter((d) => d.status === 'pending').length;
  const alertsOpen = db.prepare('SELECT COUNT(*) AS c FROM alerts WHERE acknowledged = 0').get().c;
  const jobsQueued = db.prepare(`SELECT COUNT(*) AS c FROM jobs WHERE status IN ('queued','running')`).get().c;
  const byPlatform = {};
  for (const d of devices) {
    byPlatform[d.platform] = (byPlatform[d.platform] || 0) + 1;
  }
  const recentAlerts = db.prepare(`
    SELECT a.*, d.hostname
    FROM alerts a LEFT JOIN devices d ON d.id = a.device_id
    WHERE a.acknowledged = 0
    ORDER BY a.created_at DESC LIMIT 8
  `).all();
  const recentJobs = db.prepare(`
    SELECT j.*, d.hostname
    FROM jobs j LEFT JOIN devices d ON d.id = j.device_id
    ORDER BY j.created_at DESC LIMIT 8
  `).all();

  res.json({
    totals: {
      devices: devices.length,
      online,
      offline,
      pending,
      alertsOpen,
      jobsQueued,
    },
    byPlatform,
    recentAlerts,
    recentJobs,
  });
});

/* ─── Sites & Groups ────────────────────────────────────── */

consoleRouter.get('/sites', (_req, res) => {
  const sites = db.prepare('SELECT * FROM sites ORDER BY name').all();
  res.json(sites);
});

consoleRouter.post('/sites', (req, res) => {
  const name = (req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name required' });
  const siteId = id('site');
  db.prepare('INSERT INTO sites (id, name) VALUES (?, ?)').run(siteId, name);
  audit('console', 'site.create', 'site', siteId, name);
  res.status(201).json({ id: siteId, name });
});

consoleRouter.get('/groups', (req, res) => {
  const siteId = req.query.site_id;
  const rows = siteId
    ? db.prepare('SELECT * FROM groups WHERE site_id = ? ORDER BY name').all(siteId)
    : db.prepare('SELECT * FROM groups ORDER BY name').all();
  const withCounts = rows.map((g) => ({
    ...g,
    device_count: db.prepare('SELECT COUNT(*) AS c FROM group_members WHERE group_id = ?').get(g.id).c,
  }));
  res.json(withCounts);
});

consoleRouter.post('/groups', (req, res) => {
  const { site_id, name, description = '' } = req.body || {};
  if (!site_id || !name) return res.status(400).json({ error: 'site_id and name required' });
  const gid = id('grp');
  db.prepare('INSERT INTO groups (id, site_id, name, description) VALUES (?, ?, ?, ?)').run(
    gid, site_id, name.trim(), description
  );
  audit('console', 'group.create', 'group', gid, name);
  res.status(201).json({ id: gid, site_id, name, description });
});

consoleRouter.post('/groups/:id/members', (req, res) => {
  const deviceIds = req.body?.device_ids || [];
  const insert = db.prepare(
    'INSERT OR IGNORE INTO group_members (group_id, device_id) VALUES (?, ?)'
  );
  const tx = db.transaction((ids) => {
    for (const did of ids) insert.run(req.params.id, did);
  });
  tx(deviceIds);
  res.json({ ok: true, added: deviceIds.length });
});

/* ─── Enrollment keys ───────────────────────────────────── */

consoleRouter.get('/enrollment-keys', (req, res) => {
  const siteId = req.query.site_id;
  const rows = siteId
    ? db.prepare('SELECT * FROM enrollment_keys WHERE site_id = ? ORDER BY created_at DESC').all(siteId)
    : db.prepare('SELECT * FROM enrollment_keys ORDER BY created_at DESC').all();
  res.json(rows);
});

consoleRouter.post('/enrollment-keys', (req, res) => {
  const { site_id, label = 'Default' } = req.body || {};
  if (!site_id) return res.status(400).json({ error: 'site_id required' });
  const keyId = id('ek');
  const keyValue = `frg_${token(16)}`;
  db.prepare(`
    INSERT INTO enrollment_keys (id, site_id, label, key_value)
    VALUES (?, ?, ?, ?)
  `).run(keyId, site_id, label, keyValue);
  audit('console', 'enrollment_key.create', 'enrollment_key', keyId, label);
  res.status(201).json({ id: keyId, site_id, label, key_value: keyValue });
});

/* ─── Devices ───────────────────────────────────────────── */

consoleRouter.get('/devices', (req, res) => {
  refreshDeviceStatuses(db);
  const { site_id, status, q, group_id } = req.query;
  let sql = `
    SELECT d.* FROM devices d
  `;
  const params = [];
  const where = [];

  if (group_id) {
    sql += ' INNER JOIN group_members gm ON gm.device_id = d.id';
    where.push('gm.group_id = ?');
    params.push(group_id);
  }
  if (site_id) {
    where.push('d.site_id = ?');
    params.push(site_id);
  }
  if (status) {
    where.push('d.status = ?');
    params.push(status);
  }
  if (q) {
    where.push(`(
      d.hostname LIKE ? OR d.display_name LIKE ? OR d.ip_address LIKE ?
      OR d.logged_in_user LIKE ? OR d.serial_number LIKE ?
    )`);
    const like = `%${q}%`;
    params.push(like, like, like, like, like);
  }
  if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
  sql += ` ORDER BY CASE WHEN d.last_seen IS NULL THEN 1 ELSE 0 END, d.last_seen DESC, d.hostname ASC`;

  const rows = db.prepare(sql).all(...params).map(devicePayload);
  res.json(rows);
});

consoleRouter.get('/devices/:id', (req, res) => {
  refreshDeviceStatuses(db);
  const row = db.prepare('SELECT * FROM devices WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Device not found' });
  const software = db.prepare(
    'SELECT name, version, publisher, install_date FROM software WHERE device_id = ? ORDER BY name'
  ).all(req.params.id);
  const jobs = db.prepare(
    'SELECT * FROM jobs WHERE device_id = ? ORDER BY created_at DESC LIMIT 50'
  ).all(req.params.id);
  const alerts = db.prepare(
    'SELECT * FROM alerts WHERE device_id = ? ORDER BY created_at DESC LIMIT 50'
  ).all(req.params.id);
  const groups = db.prepare(`
    SELECT g.* FROM groups g
    INNER JOIN group_members gm ON gm.group_id = g.id
    WHERE gm.device_id = ?
  `).all(req.params.id);

  res.json({
    device: devicePayload(row),
    software,
    jobs,
    alerts,
    groups,
  });
});

consoleRouter.patch('/devices/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM devices WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Device not found' });
  const displayName = req.body?.display_name ?? row.display_name;
  const tags = req.body?.tags ? JSON.stringify(req.body.tags) : row.tags;
  db.prepare('UPDATE devices SET display_name = ?, tags = ? WHERE id = ?').run(
    displayName, tags, req.params.id
  );
  audit('console', 'device.update', 'device', req.params.id, JSON.stringify(req.body || {}));
  const updated = db.prepare('SELECT * FROM devices WHERE id = ?').get(req.params.id);
  res.json(devicePayload(updated));
});

consoleRouter.delete('/devices/:id', (req, res) => {
  const info = db.prepare('DELETE FROM devices WHERE id = ?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Device not found' });
  audit('console', 'device.delete', 'device', req.params.id, '');
  res.json({ ok: true });
});

/* ─── Jobs / remote scripts ─────────────────────────────── */

consoleRouter.get('/jobs', (req, res) => {
  const { device_id, status } = req.query;
  let sql = `
    SELECT j.*, d.hostname FROM jobs j
    LEFT JOIN devices d ON d.id = j.device_id
  `;
  const params = [];
  const where = [];
  if (device_id) { where.push('j.device_id = ?'); params.push(device_id); }
  if (status) { where.push('j.status = ?'); params.push(status); }
  if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
  sql += ' ORDER BY j.created_at DESC LIMIT 200';
  res.json(db.prepare(sql).all(...params));
});

consoleRouter.post('/jobs', (req, res) => {
  const { device_id, device_ids, title, payload, type = 'script', shell = 'auto', timeout_seconds = 300 } = req.body || {};
  const targets = device_ids?.length ? device_ids : (device_id ? [device_id] : []);
  if (!targets.length || !payload) {
    return res.status(400).json({ error: 'device_id(s) and payload required' });
  }

  const created = [];
  const insert = db.prepare(`
    INSERT INTO jobs (id, device_id, type, title, payload, shell, timeout_seconds, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'console')
  `);
  const tx = db.transaction((ids) => {
    for (const did of ids) {
      const device = db.prepare('SELECT id FROM devices WHERE id = ?').get(did);
      if (!device) continue;
      const jobId = id('job');
      insert.run(jobId, did, type, title || 'Remote script', payload, shell, timeout_seconds);
      created.push(jobId);
      audit('console', 'job.create', 'job', jobId, `${type} → ${did}`);
    }
  });
  tx(targets);
  res.status(201).json({ job_ids: created });
});

consoleRouter.get('/jobs/:id', (req, res) => {
  const job = db.prepare(`
    SELECT j.*, d.hostname FROM jobs j
    LEFT JOIN devices d ON d.id = j.device_id
    WHERE j.id = ?
  `).get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

consoleRouter.post('/jobs/:id/cancel', (req, res) => {
  const info = db.prepare(`
    UPDATE jobs SET status = 'cancelled', completed_at = datetime('now')
    WHERE id = ? AND status = 'queued'
  `).run(req.params.id);
  if (!info.changes) return res.status(400).json({ error: 'Job not cancellable' });
  res.json({ ok: true });
});

/* ─── Alerts ────────────────────────────────────────────── */

consoleRouter.get('/alerts', (req, res) => {
  const openOnly = req.query.open !== 'false';
  const sql = openOnly
    ? `SELECT a.*, d.hostname FROM alerts a LEFT JOIN devices d ON d.id = a.device_id
       WHERE a.acknowledged = 0 ORDER BY a.created_at DESC LIMIT 200`
    : `SELECT a.*, d.hostname FROM alerts a LEFT JOIN devices d ON d.id = a.device_id
       ORDER BY a.created_at DESC LIMIT 200`;
  res.json(db.prepare(sql).all());
});

consoleRouter.post('/alerts/:id/ack', (req, res) => {
  const info = db.prepare(`
    UPDATE alerts SET acknowledged = 1, acknowledged_at = datetime('now') WHERE id = ?
  `).run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Alert not found' });
  audit('console', 'alert.ack', 'alert', req.params.id, '');
  res.json({ ok: true });
});

consoleRouter.post('/alerts/ack-all', (_req, res) => {
  db.prepare(`
    UPDATE alerts SET acknowledged = 1, acknowledged_at = datetime('now') WHERE acknowledged = 0
  `).run();
  res.json({ ok: true });
});

/* ─── Policies ──────────────────────────────────────────── */

consoleRouter.get('/policies', (req, res) => {
  const siteId = req.query.site_id;
  const rows = siteId
    ? db.prepare('SELECT * FROM policies WHERE site_id = ?').all(siteId)
    : db.prepare('SELECT * FROM policies').all();
  res.json(rows.map((p) => ({ ...p, rules: parseJson(p.rules, {}) })));
});

consoleRouter.post('/policies', (req, res) => {
  const { site_id, name, description = '', rules = {}, enabled = true } = req.body || {};
  if (!site_id || !name) return res.status(400).json({ error: 'site_id and name required' });
  const pid = id('pol');
  db.prepare(`
    INSERT INTO policies (id, site_id, name, description, rules, enabled)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(pid, site_id, name, description, JSON.stringify(rules), enabled ? 1 : 0);
  audit('console', 'policy.create', 'policy', pid, name);
  res.status(201).json({ id: pid });
});

/* ─── Audit ─────────────────────────────────────────────── */

consoleRouter.get('/audit', (_req, res) => {
  res.json(db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 100').all());
});

/* ═════════════════════════════════════════════════════════
   Agent API
   ═════════════════════════════════════════════════════════ */

agentRouter.post('/enroll', (req, res) => {
  const { enrollment_key, hostname, platform, os_name, os_version, agent_version } = req.body || {};
  if (!enrollment_key || !hostname) {
    return res.status(400).json({ error: 'enrollment_key and hostname required' });
  }

  const key = db.prepare(
    'SELECT * FROM enrollment_keys WHERE key_value = ? AND revoked = 0'
  ).get(enrollment_key);
  if (!key) return res.status(403).json({ error: 'Invalid enrollment key' });
  if (key.max_uses > 0 && key.use_count >= key.max_uses) {
    return res.status(403).json({ error: 'Enrollment key exhausted' });
  }

  const deviceId = id('dev');
  const deviceToken = token(32);

  db.prepare(`
    INSERT INTO devices (
      id, site_id, hostname, platform, os_name, os_version, agent_version,
      enrollment_token, status, enrolled_at, last_seen
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'online', datetime('now'), datetime('now'))
  `).run(
    deviceId, key.site_id, hostname,
    platform || 'unknown', os_name || '', os_version || '', agent_version || '0.1.0',
    deviceToken
  );

  db.prepare('UPDATE enrollment_keys SET use_count = use_count + 1 WHERE id = ?').run(key.id);
  audit('agent', 'device.enroll', 'device', deviceId, hostname);

  res.status(201).json({
    device_id: deviceId,
    device_token: deviceToken,
    site_id: key.site_id,
    poll_interval_seconds: 30,
  });
});

function requireAgent(req, res, next) {
  const deviceId = req.header('x-device-id');
  const deviceToken = req.header('x-device-token');
  if (!deviceId || !deviceToken) {
    return res.status(401).json({ error: 'Missing device credentials' });
  }
  const device = db.prepare(
    'SELECT * FROM devices WHERE id = ? AND enrollment_token = ?'
  ).get(deviceId, deviceToken);
  if (!device) return res.status(401).json({ error: 'Invalid device credentials' });
  req.device = device;
  next();
}

agentRouter.post('/heartbeat', requireAgent, (req, res) => {
  const b = req.body || {};
  const meta = {
    ...(parseJson(req.device.metadata, {})),
    ...(b.metadata || {}),
    mem_used_pct: b.mem_used_pct ?? null,
    cpu_pct: b.cpu_pct ?? null,
  };

  db.prepare(`
    UPDATE devices SET
      status = 'online',
      last_seen = datetime('now'),
      hostname = COALESCE(?, hostname),
      platform = COALESCE(?, platform),
      os_name = COALESCE(?, os_name),
      os_version = COALESCE(?, os_version),
      agent_version = COALESCE(?, agent_version),
      ip_address = COALESCE(?, ip_address),
      mac_address = COALESCE(?, mac_address),
      cpu_model = COALESCE(?, cpu_model),
      cpu_cores = COALESCE(?, cpu_cores),
      ram_gb = COALESCE(?, ram_gb),
      disk_total_gb = COALESCE(?, disk_total_gb),
      disk_free_gb = COALESCE(?, disk_free_gb),
      uptime_seconds = COALESCE(?, uptime_seconds),
      logged_in_user = COALESCE(?, logged_in_user),
      manufacturer = COALESCE(?, manufacturer),
      model = COALESCE(?, model),
      serial_number = COALESCE(?, serial_number),
      metadata = ?
    WHERE id = ?
  `).run(
    b.hostname ?? null,
    b.platform ?? null,
    b.os_name ?? null,
    b.os_version ?? null,
    b.agent_version ?? null,
    b.ip_address ?? null,
    b.mac_address ?? null,
    b.cpu_model ?? null,
    b.cpu_cores ?? null,
    b.ram_gb ?? null,
    b.disk_total_gb ?? null,
    b.disk_free_gb ?? null,
    b.uptime_seconds ?? null,
    b.logged_in_user ?? null,
    b.manufacturer ?? null,
    b.model ?? null,
    b.serial_number ?? null,
    JSON.stringify(meta),
    req.device.id
  );

  const updated = db.prepare('SELECT * FROM devices WHERE id = ?').get(req.device.id);
  evaluateAlerts(db, { ...updated, metadata: meta });

  const jobs = db.prepare(`
    SELECT id, type, title, payload, shell, timeout_seconds
    FROM jobs WHERE device_id = ? AND status = 'queued'
    ORDER BY created_at ASC LIMIT 5
  `).all(req.device.id);

  if (jobs.length) {
    const mark = db.prepare(`
      UPDATE jobs SET status = 'running', started_at = datetime('now') WHERE id = ?
    `);
    for (const j of jobs) mark.run(j.id);
  }

  const policies = db.prepare(
    'SELECT id, name, rules FROM policies WHERE site_id = ? AND enabled = 1'
  ).all(req.device.site_id).map((p) => ({ ...p, rules: parseJson(p.rules, {}) }));

  res.json({
    ok: true,
    jobs,
    policies,
    poll_interval_seconds: 30,
  });
});

agentRouter.post('/inventory', requireAgent, (req, res) => {
  const apps = Array.isArray(req.body?.software) ? req.body.software : [];
  const del = db.prepare('DELETE FROM software WHERE device_id = ?');
  const ins = db.prepare(`
    INSERT OR IGNORE INTO software (device_id, name, version, publisher, install_date)
    VALUES (?, ?, ?, ?, ?)
  `);
  const tx = db.transaction((list) => {
    del.run(req.device.id);
    for (const app of list.slice(0, 2000)) {
      if (!app?.name) continue;
      ins.run(
        req.device.id,
        String(app.name).slice(0, 256),
        String(app.version || '').slice(0, 128),
        String(app.publisher || '').slice(0, 256),
        String(app.install_date || '').slice(0, 64)
      );
    }
  });
  tx(apps);
  res.json({ ok: true, count: apps.length });
});

agentRouter.post('/jobs/:id/result', requireAgent, (req, res) => {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ? AND device_id = ?').get(
    req.params.id, req.device.id
  );
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const { exit_code = 0, stdout = '', stderr = '', status } = req.body || {};
  const finalStatus = status || (exit_code === 0 ? 'succeeded' : 'failed');

  db.prepare(`
    UPDATE jobs SET
      status = ?,
      exit_code = ?,
      stdout = ?,
      stderr = ?,
      completed_at = datetime('now')
    WHERE id = ?
  `).run(
    finalStatus,
    exit_code,
    String(stdout).slice(0, 200000),
    String(stderr).slice(0, 50000),
    job.id
  );

  if (finalStatus === 'failed') {
    db.prepare(`
      INSERT INTO alerts (id, device_id, severity, category, title, message)
      VALUES (?, ?, 'warning', 'jobs', ?, ?)
    `).run(
      id('alt'),
      req.device.id,
      `Job failed: ${job.title || job.id}`,
      `Remote job on ${req.device.hostname} exited with code ${exit_code}.`
    );
  }

  audit('agent', 'job.complete', 'job', job.id, finalStatus);
  res.json({ ok: true });
});
