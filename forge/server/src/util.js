import { customAlphabet } from 'nanoid';
import { randomBytes } from 'crypto';

const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 16);

export function id(prefix = '') {
  return prefix ? `${prefix}_${nanoid()}` : nanoid();
}

export function token(bytes = 24) {
  return randomBytes(bytes).toString('hex');
}

export function parseJson(value, fallback) {
  try {
    return JSON.parse(value ?? '');
  } catch {
    return fallback;
  }
}

export function devicePayload(row) {
  if (!row) return null;
  return {
    ...row,
    tags: parseJson(row.tags, []),
    metadata: parseJson(row.metadata, {}),
    acknowledged: undefined,
  };
}

/** Mark devices offline if last_seen older than threshold (default 3 minutes). */
export function refreshDeviceStatuses(db, offlineSeconds = 180) {
  db.prepare(`
    UPDATE devices
    SET status = 'offline'
    WHERE status = 'online'
      AND last_seen IS NOT NULL
      AND datetime(last_seen) < datetime('now', ?)
  `).run(`-${offlineSeconds} seconds`);
}

export function evaluateAlerts(db, device) {
  const insert = db.prepare(`
    INSERT INTO alerts (id, device_id, severity, category, title, message)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const recent = db.prepare(`
    SELECT title FROM alerts
    WHERE device_id = ? AND created_at > datetime('now', '-30 minutes')
  `).all(device.id).map((a) => a.title);

  if (device.disk_total_gb > 0) {
    const freePct = (device.disk_free_gb / device.disk_total_gb) * 100;
    if (freePct < 10 && !recent.includes('Low disk space')) {
      insert.run(
        id('alt'),
        device.id,
        'critical',
        'storage',
        'Low disk space',
        `${device.hostname} has only ${device.disk_free_gb.toFixed(1)} GB free (${freePct.toFixed(0)}%).`
      );
    } else if (freePct < 20 && !recent.includes('Disk space warning')) {
      insert.run(
        id('alt'),
        device.id,
        'warning',
        'storage',
        'Disk space warning',
        `${device.hostname} has ${device.disk_free_gb.toFixed(1)} GB free (${freePct.toFixed(0)}%).`
      );
    }
  }

  if (device.ram_gb > 0 && device.metadata) {
    const meta = typeof device.metadata === 'string'
      ? parseJson(device.metadata, {})
      : device.metadata;
    if (meta.mem_used_pct >= 95 && !recent.includes('High memory usage')) {
      insert.run(
        id('alt'),
        device.id,
        'warning',
        'performance',
        'High memory usage',
        `${device.hostname} memory usage at ${meta.mem_used_pct}%.`
      );
    }
  }
}
