const API_KEY = localStorage.getItem('forge_api_key') || 'forge-dev-console-key';
const state = {
  view: 'dashboard',
  devices: [],
  search: '',
  selectedDeviceId: null,
};

async function api(path, options = {}) {
  const res = await fetch(`/api/v1/console${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': API_KEY,
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `Request failed (${res.status})`);
  }
  return res.json();
}

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function fmtTime(v) {
  if (!v) return '—';
  const d = new Date(v.includes('T') ? v : v.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleString();
}

function fmtBytesGb(n) {
  if (n == null || n === '') return '—';
  return `${Number(n).toFixed(Number(n) < 10 ? 1 : 0)} GB`;
}

function platformLabel(p) {
  return ({ darwin: 'macOS', windows: 'Windows', linux: 'Linux' }[p] || p || 'Unknown');
}

function setServerStatus(ok, text) {
  const node = document.getElementById('server-status');
  node.textContent = text;
  node.classList.toggle('ok', ok);
}

const titles = {
  dashboard: ['Overview', 'Fleet health across your managed workstations'],
  devices: ['Devices', 'Inventory, status, and endpoint details'],
  jobs: ['Jobs', 'Remote scripts and automation history'],
  alerts: ['Alerts', 'Disk, availability, and job failures'],
  groups: ['Groups', 'Logical collections for targeting'],
  enroll: ['Enrollment', 'Keys and agent install commands'],
};

function setView(view) {
  state.view = view;
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });
  const [title, sub] = titles[view];
  document.getElementById('view-title').textContent = title;
  document.getElementById('view-subtitle').textContent = sub;
  render();
}

async function render() {
  const root = document.getElementById('view-root');
  root.innerHTML = `<div class="empty">Loading…</div>`;
  try {
    if (state.view === 'dashboard') await renderDashboard(root);
    else if (state.view === 'devices') await renderDevices(root);
    else if (state.view === 'jobs') await renderJobs(root);
    else if (state.view === 'alerts') await renderAlerts(root);
    else if (state.view === 'groups') await renderGroups(root);
    else if (state.view === 'enroll') await renderEnroll(root);
    setServerStatus(true, 'Server online');
  } catch (e) {
    setServerStatus(false, 'Server unreachable');
    root.innerHTML = `<div class="empty">${escapeHtml(e.message)}</div>`;
  }
}

async function renderDashboard(root) {
  const data = await api('/dashboard');
  const t = data.totals;
  const totalPlat = Object.values(data.byPlatform).reduce((a, b) => a + b, 0) || 1;

  root.innerHTML = '';
  root.appendChild(el(`
    <div class="metrics">
      <div class="metric"><div class="label">Devices</div><div class="value">${t.devices}</div></div>
      <div class="metric"><div class="label">Online</div><div class="value accent">${t.online}</div></div>
      <div class="metric"><div class="label">Offline</div><div class="value crit">${t.offline}</div></div>
      <div class="metric"><div class="label">Pending</div><div class="value warn">${t.pending}</div></div>
      <div class="metric"><div class="label">Open alerts</div><div class="value ${t.alertsOpen ? 'warn' : ''}">${t.alertsOpen}</div></div>
      <div class="metric"><div class="label">Active jobs</div><div class="value">${t.jobsQueued}</div></div>
    </div>
  `));

  const panels = el(`<div class="panels"></div>`);
  const alertsPanel = el(`
    <section class="panel">
      <div class="panel-head"><h3>Open alerts</h3></div>
      <div class="panel-body"></div>
    </section>
  `);
  const alertsBody = alertsPanel.querySelector('.panel-body');
  if (!data.recentAlerts.length) {
    alertsBody.innerHTML = `<div class="empty">No open alerts</div>`;
  } else {
    for (const a of data.recentAlerts) {
      alertsBody.appendChild(el(`
        <div class="list-row">
          <div>
            <div><span class="sev-dot ${escapeHtml(a.severity)}"></span><strong>${escapeHtml(a.title)}</strong></div>
            <div class="muted" style="margin-top:4px">${escapeHtml(a.hostname || '—')} · ${escapeHtml(a.message)}</div>
          </div>
          <button class="ghost-btn ack-btn" data-id="${escapeHtml(a.id)}" type="button">Ack</button>
        </div>
      `));
    }
  }

  const platPanel = el(`
    <section class="panel">
      <div class="panel-head"><h3>Platform mix</h3></div>
      <div class="platform-bars"></div>
    </section>
  `);
  const bars = platPanel.querySelector('.platform-bars');
  const platforms = Object.entries(data.byPlatform);
  if (!platforms.length) {
    bars.innerHTML = `<div class="empty">No devices yet</div>`;
  } else {
    for (const [name, count] of platforms) {
      const pct = Math.round((count / totalPlat) * 100);
      bars.appendChild(el(`
        <div class="bar-row">
          <div>${escapeHtml(platformLabel(name))}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
          <div class="mono">${count}</div>
        </div>
      `));
    }
  }

  panels.append(alertsPanel, platPanel);
  root.appendChild(panels);

  const jobsPanel = el(`
    <section class="panel" style="margin-top:16px">
      <div class="panel-head"><h3>Recent jobs</h3></div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Title</th><th>Device</th><th>Status</th><th>Created</th></tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
    </section>
  `);
  const tbody = jobsPanel.querySelector('tbody');
  if (!data.recentJobs.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty">No jobs yet</td></tr>`;
  } else {
    for (const j of data.recentJobs) {
      tbody.appendChild(el(`
        <tr>
          <td>${escapeHtml(j.title || j.type)}</td>
          <td>${escapeHtml(j.hostname || '—')}</td>
          <td><span class="badge ${escapeHtml(j.status)}">${escapeHtml(j.status)}</span></td>
          <td class="mono">${escapeHtml(fmtTime(j.created_at))}</td>
        </tr>
      `));
    }
  }
  root.appendChild(jobsPanel);

  alertsBody.querySelectorAll('.ack-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await api(`/alerts/${btn.dataset.id}/ack`, { method: 'POST', body: '{}' });
      render();
    });
  });
}

async function renderDevices(root) {
  const q = state.search.trim();
  const devices = await api(`/devices${q ? `?q=${encodeURIComponent(q)}` : ''}`);
  state.devices = devices;

  root.innerHTML = '';
  root.appendChild(el(`
    <div class="toolbar">
      <select id="status-filter">
        <option value="">All statuses</option>
        <option value="online">Online</option>
        <option value="offline">Offline</option>
        <option value="pending">Pending</option>
      </select>
      <span class="muted">${devices.length} device${devices.length === 1 ? '' : 's'}</span>
    </div>
  `));

  const table = el(`
    <div class="panel table-wrap">
      <table>
        <thead>
          <tr>
            <th>Hostname</th>
            <th>Status</th>
            <th>Platform</th>
            <th>User</th>
            <th>IP</th>
            <th>Disk free</th>
            <th>Last seen</th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
    </div>
  `);
  const tbody = table.querySelector('tbody');

  const paint = (list) => {
    tbody.innerHTML = '';
    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty">No devices match</td></tr>`;
      return;
    }
    for (const d of list) {
      const row = el(`
        <tr class="clickable" data-id="${escapeHtml(d.id)}">
          <td>
            <strong>${escapeHtml(d.display_name || d.hostname)}</strong>
            <div class="muted mono" style="font-size:0.75rem">${escapeHtml(d.id)}</div>
          </td>
          <td><span class="badge ${escapeHtml(d.status)}">${escapeHtml(d.status)}</span></td>
          <td>${escapeHtml(platformLabel(d.platform))} ${escapeHtml(d.os_version || '')}</td>
          <td>${escapeHtml(d.logged_in_user || '—')}</td>
          <td class="mono">${escapeHtml(d.ip_address || '—')}</td>
          <td>${escapeHtml(fmtBytesGb(d.disk_free_gb))}</td>
          <td class="mono">${escapeHtml(fmtTime(d.last_seen))}</td>
        </tr>
      `);
      row.addEventListener('click', () => openDevice(d.id));
      tbody.appendChild(row);
    }
  };

  paint(devices);
  root.appendChild(table);

  root.querySelector('#status-filter').addEventListener('change', (e) => {
    const v = e.target.value;
    paint(v ? devices.filter((d) => d.status === v) : devices);
  });
}

async function openDevice(id) {
  const data = await api(`/devices/${id}`);
  const d = data.device;
  const dialog = document.getElementById('device-dialog');
  document.getElementById('device-title').textContent = d.display_name || d.hostname;
  document.getElementById('device-sub').textContent =
    `${platformLabel(d.platform)} · ${d.os_name} ${d.os_version} · ${d.status}`;

  const detail = document.getElementById('device-detail');
  detail.innerHTML = `
    <div class="detail-grid">
      <div class="stat"><div class="k">Hostname</div><div class="v">${escapeHtml(d.hostname)}</div></div>
      <div class="stat"><div class="k">Serial</div><div class="v mono">${escapeHtml(d.serial_number || '—')}</div></div>
      <div class="stat"><div class="k">User</div><div class="v">${escapeHtml(d.logged_in_user || '—')}</div></div>
      <div class="stat"><div class="k">IP</div><div class="v mono">${escapeHtml(d.ip_address || '—')}</div></div>
      <div class="stat"><div class="k">CPU</div><div class="v">${escapeHtml(d.cpu_model || '—')} (${d.cpu_cores || 0} cores)</div></div>
      <div class="stat"><div class="k">Memory</div><div class="v">${escapeHtml(fmtBytesGb(d.ram_gb))}</div></div>
      <div class="stat"><div class="k">Disk</div><div class="v">${escapeHtml(fmtBytesGb(d.disk_free_gb))} free / ${escapeHtml(fmtBytesGb(d.disk_total_gb))}</div></div>
      <div class="stat"><div class="k">Agent</div><div class="v mono">v${escapeHtml(d.agent_version || '—')}</div></div>
      <div class="stat"><div class="k">Manufacturer</div><div class="v">${escapeHtml(d.manufacturer || '—')}</div></div>
      <div class="stat"><div class="k">Model</div><div class="v">${escapeHtml(d.model || '—')}</div></div>
      <div class="stat"><div class="k">Last seen</div><div class="v mono">${escapeHtml(fmtTime(d.last_seen))}</div></div>
      <div class="stat"><div class="k">Enrolled</div><div class="v mono">${escapeHtml(fmtTime(d.enrolled_at))}</div></div>
    </div>
    <div class="tabs">
      <button class="tab active" data-tab="software" type="button">Software</button>
      <button class="tab" data-tab="jobs" type="button">Jobs</button>
      <button class="tab" data-tab="alerts" type="button">Alerts</button>
    </div>
    <div id="device-tab-body"></div>
  `;

  const body = detail.querySelector('#device-tab-body');
  const showTab = (name) => {
    detail.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    if (name === 'software') {
      if (!data.software.length) {
        body.innerHTML = `<div class="empty">No software inventory yet</div>`;
      } else {
        body.innerHTML = `<div class="table-wrap"><table>
          <thead><tr><th>Name</th><th>Version</th><th>Publisher</th></tr></thead>
          <tbody>${data.software.map((s) => `
            <tr>
              <td>${escapeHtml(s.name)}</td>
              <td class="mono">${escapeHtml(s.version || '—')}</td>
              <td>${escapeHtml(s.publisher || '—')}</td>
            </tr>`).join('')}</tbody></table></div>`;
      }
    } else if (name === 'jobs') {
      if (!data.jobs.length) {
        body.innerHTML = `<div class="empty">No jobs for this device</div>`;
      } else {
        body.innerHTML = data.jobs.map((j) => `
          <div class="list-row" style="grid-template-columns:1fr">
            <div>
              <div><strong>${escapeHtml(j.title)}</strong> <span class="badge ${escapeHtml(j.status)}">${escapeHtml(j.status)}</span></div>
              <div class="muted mono" style="margin:6px 0">${escapeHtml(fmtTime(j.created_at))}</div>
              ${j.stdout ? `<div class="pre">${escapeHtml(j.stdout)}</div>` : ''}
              ${j.stderr ? `<div class="pre" style="margin-top:8px;color:var(--crit)">${escapeHtml(j.stderr)}</div>` : ''}
            </div>
          </div>`).join('');
      }
    } else {
      if (!data.alerts.length) {
        body.innerHTML = `<div class="empty">No alerts</div>`;
      } else {
        body.innerHTML = data.alerts.map((a) => `
          <div class="list-row">
            <div>
              <div><span class="sev-dot ${escapeHtml(a.severity)}"></span>${escapeHtml(a.title)}</div>
              <div class="muted">${escapeHtml(a.message)}</div>
            </div>
            <span class="muted mono">${escapeHtml(fmtTime(a.created_at))}</span>
          </div>`).join('');
      }
    }
  };

  detail.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => showTab(tab.dataset.tab));
  });
  showTab('software');
  dialog.showModal();
}

async function renderJobs(root) {
  const jobs = await api('/jobs');
  root.innerHTML = '';
  const panel = el(`
    <div class="panel table-wrap">
      <table>
        <thead>
          <tr><th>Title</th><th>Device</th><th>Status</th><th>Exit</th><th>Created</th><th>Completed</th></tr>
        </thead>
        <tbody></tbody>
      </table>
    </div>
  `);
  const tbody = panel.querySelector('tbody');
  if (!jobs.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty">No jobs yet — queue a script from Run script</td></tr>`;
  } else {
    for (const j of jobs) {
      tbody.appendChild(el(`
        <tr class="clickable" data-id="${escapeHtml(j.id)}">
          <td>${escapeHtml(j.title || j.type)}</td>
          <td>${escapeHtml(j.hostname || j.device_id)}</td>
          <td><span class="badge ${escapeHtml(j.status)}">${escapeHtml(j.status)}</span></td>
          <td class="mono">${j.exit_code ?? '—'}</td>
          <td class="mono">${escapeHtml(fmtTime(j.created_at))}</td>
          <td class="mono">${escapeHtml(fmtTime(j.completed_at))}</td>
        </tr>
      `));
    }
  }
  root.appendChild(panel);

  tbody.querySelectorAll('tr.clickable').forEach((row) => {
    row.addEventListener('click', async () => {
      const job = await api(`/jobs/${row.dataset.id}`);
      alert(`${job.title}\n\nStatus: ${job.status}\nExit: ${job.exit_code ?? '—'}\n\n${job.stdout || ''}\n${job.stderr || ''}`);
    });
  });
}

async function renderAlerts(root) {
  const alerts = await api('/alerts');
  root.innerHTML = '';
  root.appendChild(el(`
    <div class="toolbar">
      <button class="ghost-btn" id="ack-all" type="button">Acknowledge all</button>
      <span class="muted">${alerts.length} open</span>
    </div>
  `));
  const panel = el(`<section class="panel"><div class="panel-body"></div></section>`);
  const body = panel.querySelector('.panel-body');
  if (!alerts.length) {
    body.innerHTML = `<div class="empty">All clear — no open alerts</div>`;
  } else {
    for (const a of alerts) {
      body.appendChild(el(`
        <div class="list-row">
          <div>
            <div><span class="badge ${escapeHtml(a.severity)}">${escapeHtml(a.severity)}</span> <strong>${escapeHtml(a.title)}</strong></div>
            <div class="muted" style="margin-top:6px">${escapeHtml(a.hostname || '—')} · ${escapeHtml(a.message)}</div>
            <div class="muted mono" style="margin-top:4px;font-size:0.75rem">${escapeHtml(fmtTime(a.created_at))}</div>
          </div>
          <button class="ghost-btn ack-btn" data-id="${escapeHtml(a.id)}" type="button">Ack</button>
        </div>
      `));
    }
  }
  root.appendChild(panel);

  document.getElementById('ack-all').addEventListener('click', async () => {
    await api('/alerts/ack-all', { method: 'POST', body: '{}' });
    render();
  });
  body.querySelectorAll('.ack-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await api(`/alerts/${btn.dataset.id}/ack`, { method: 'POST', body: '{}' });
      render();
    });
  });
}

async function renderGroups(root) {
  const groups = await api('/groups');
  root.innerHTML = '';
  const panel = el(`
    <div class="panel table-wrap">
      <table>
        <thead><tr><th>Name</th><th>Description</th><th>Devices</th><th>Created</th></tr></thead>
        <tbody></tbody>
      </table>
    </div>
  `);
  const tbody = panel.querySelector('tbody');
  for (const g of groups) {
    tbody.appendChild(el(`
      <tr>
        <td><strong>${escapeHtml(g.name)}</strong></td>
        <td>${escapeHtml(g.description || '—')}</td>
        <td class="mono">${g.device_count}</td>
        <td class="mono">${escapeHtml(fmtTime(g.created_at))}</td>
      </tr>
    `));
  }
  if (!groups.length) tbody.innerHTML = `<tr><td colspan="4" class="empty">No groups</td></tr>`;
  root.appendChild(panel);
}

async function renderEnroll(root) {
  const keys = await api('/enrollment-keys');
  const sites = await api('/sites');
  const key = keys[0];
  const site = sites[0];

  let windows = null;
  try {
    const qs = key?.key_value ? `?key=${encodeURIComponent(key.key_value)}` : '';
    const res = await fetch(`/download/windows-agent${qs}`);
    if (res.ok) windows = await res.json();
  } catch {
    windows = null;
  }

  const winUrl = windows?.download_url || `${window.location.origin}/download/windows-agent.ps1`;
  const silent = windows?.silent_install
    || `powershell -NoProfile -ExecutionPolicy Bypass -Command "iex (irm '${winUrl}')"`;

  root.innerHTML = '';
  root.appendChild(el(`
    <div class="panels">
      <section class="panel">
        <div class="panel-head"><h3>Enrollment key</h3></div>
        <div style="padding:18px">
          <p class="muted" style="margin-bottom:12px">Site: <strong style="color:var(--text)">${escapeHtml(site?.name || '—')}</strong></p>
          <div class="code-block">${escapeHtml(key?.key_value || 'Run npm run seed to create a key')}</div>
          <p class="muted" style="margin-top:12px">Uses: ${key?.use_count ?? 0}${key?.max_uses ? ` / ${key.max_uses}` : ''}</p>
          <div class="toolbar" style="margin-top:16px;margin-bottom:0">
            <button class="primary-btn" id="new-key" type="button">Generate new key</button>
          </div>
        </div>
      </section>
      <section class="panel">
        <div class="panel-head"><h3>Windows agent link</h3></div>
        <div style="padding:18px">
          <p class="muted" style="margin-bottom:12px">Silent install (Administrator PowerShell) — no App Store:</p>
          <div class="code-block" id="win-silent">${escapeHtml(silent)}</div>
          <div class="toolbar" style="margin-top:14px">
            <a class="primary-btn" href="${escapeHtml(winUrl)}" download="windows-agent.ps1">Download Windows agent</a>
            <button class="ghost-btn" id="copy-win" type="button">Copy install command</button>
          </div>
          <p class="muted" style="margin-top:14px">Installs to <span class="mono">Program Files\\ForgeAgent</span> and starts scheduled task <span class="mono">ForgeAgent</span>.</p>
        </div>
      </section>
    </div>
    <section class="panel" style="margin-top:16px">
      <div class="panel-head"><h3>Other platforms (Python agent)</h3></div>
      <div style="padding:18px">
        <div class="code-block">python3 forge_agent.py enroll \\
  --server ${escapeHtml(windows?.server || 'http://YOUR_SERVER:8787')} \\
  --key ${escapeHtml(key?.key_value || 'ENROLLMENT_KEY')}

python3 forge_agent.py run</div>
        <p class="muted" style="margin-top:14px">Agent path: <span class="mono">forge/agent/forge_agent.py</span></p>
      </div>
    </section>
  `));

  root.querySelector('#new-key')?.addEventListener('click', async () => {
    if (!site) return;
    await api('/enrollment-keys', {
      method: 'POST',
      body: JSON.stringify({ site_id: site.id, label: `Key ${new Date().toLocaleString()}` }),
    });
    render();
  });

  root.querySelector('#copy-win')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(silent);
      const btn = root.querySelector('#copy-win');
      btn.textContent = 'Copied';
      setTimeout(() => { btn.textContent = 'Copy install command'; }, 1500);
    } catch {
      alert('Copy failed — select the command manually.');
    }
  });
}

async function openJobDialog() {
  const devices = state.devices.length ? state.devices : await api('/devices');
  state.devices = devices;
  const select = document.getElementById('job-devices');
  select.innerHTML = devices
    .filter((d) => d.status !== 'pending')
    .map((d) => `<option value="${escapeHtml(d.id)}">${escapeHtml(d.hostname)} (${escapeHtml(d.status)})</option>`)
    .join('');
  document.getElementById('job-title').value = '';
  document.getElementById('job-payload').value = '';
  document.getElementById('job-shell').value = 'auto';
  document.getElementById('job-dialog').showModal();
}

document.getElementById('job-form').addEventListener('submit', async (e) => {
  const submitter = e.submitter;
  if (submitter?.value === 'cancel') return;
  e.preventDefault();
  const select = document.getElementById('job-devices');
  const device_ids = [...select.selectedOptions].map((o) => o.value);
  if (!device_ids.length) {
    alert('Select at least one device');
    return;
  }
  await api('/jobs', {
    method: 'POST',
    body: JSON.stringify({
      device_ids,
      title: document.getElementById('job-title').value,
      payload: document.getElementById('job-payload').value,
      shell: document.getElementById('job-shell').value,
    }),
  });
  document.getElementById('job-dialog').close();
  setView('jobs');
});

document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => setView(btn.dataset.view));
});
document.getElementById('refresh-btn').addEventListener('click', () => render());
document.getElementById('new-job-btn').addEventListener('click', () => openJobDialog());
document.getElementById('close-device').addEventListener('click', () => {
  document.getElementById('device-dialog').close();
});
document.getElementById('search').addEventListener('input', (e) => {
  state.search = e.target.value;
  if (state.view === 'devices') render();
});

// Health ping
fetch('/api/health')
  .then((r) => r.json())
  .then(() => setServerStatus(true, 'Server online'))
  .catch(() => setServerStatus(false, 'Server offline'));

setView('dashboard');
setInterval(() => {
  if (!document.querySelector('dialog[open]')) render();
}, 20000);
