// ============================================================
//  OCSF LOG MAPPER — control.js
//  Used by: control.html
//  Depends on: shared.js  (Store, KEYS, rand, pick)
// ============================================================

// ── STATE ──
let groups      = [];
let dashboards  = [];
let activityLog = [];
let startTime   = Date.now();
let currentView = 'grid';

// ── INIT ──
function init() {
  groups = Store.get(KEYS.GROUPS);

  if (!groups || !groups.length) {
    document.getElementById('cards-grid').innerHTML = `
      <div class="empty-control">
        <div class="ec-icon">🗂️</div>
        <div class="ec-title">NO DASHBOARDS YET</div>
        <p class="ec-sub">Upload log files and create groups first. Each group will appear here as a controllable dashboard.</p>
        <a href="upload.html" class="btn btn-primary">→ Go to Upload</a>
      </div>`;
    document.getElementById('list-rows').innerHTML = '';
    updateClock();
    return;
  }

  dashboards = groups.map((g, i) => ({
    ...g,
    status: i === 0 ? 'running' : i === 1 ? 'running' : i === 2 ? 'paused' : 'stopped',
    events: rand(120, 4800),
    errors: rand(0, 24),
    rate:   rand(88, 99),
    spark:  Array.from({ length: 16 }, () => rand(5, 100)),
    lastSeen: new Date(),
  }));

  pushLog('Control panel online — system initialised', 'info');
  dashboards.filter(d => d.status === 'running').forEach(d =>
    pushLog(`"${d.name}" is running`, 'success'));

  renderAll();
  updateClock();
  updateHealth();
}

// ── RENDER ALL ──
function renderAll() {
  renderCards();
  renderListRows();
  updateSystemMetrics();
  updateRunningBadge();
}

// ── SPARKLINE HELPER ──
function buildSparkPts(data, w, h) {
  const max = Math.max(...data, 1);
  return data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - (v / max) * (h - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

// ── GRID CARDS ──
function renderCards() {
  document.getElementById('cards-grid').innerHTML = dashboards.map(d => {
    const pts = buildSparkPts(d.spark, 280, 32);
    return `
      <div class="dash-card" id="card-${d.id}">
        <div class="dc-statusbar" style="background:linear-gradient(90deg,${d.color},transparent);"></div>
        <div class="dc-header">
          <span class="dc-color-dot" style="background:${d.color};box-shadow:0 0 6px ${d.color}66;"></span>
          <div class="dc-info">
            <div class="dc-name">${d.name}</div>
            <div class="dc-source">${(d.files || []).length} file${(d.files || []).length !== 1 ? 's' : ''}</div>
          </div>
          <span class="dc-status-badge status-${d.status}">${d.status}</span>
        </div>

        <div class="dc-metrics">
          <div class="dc-metric">
            <div class="dcm-val" style="color:${d.color};">${d.events.toLocaleString()}</div>
            <div class="dcm-label">Events</div>
          </div>
          <div class="dc-metric">
            <div class="dcm-val" style="color:${d.errors > 10 ? 'var(--red)' : 'var(--green)'};">${d.errors}</div>
            <div class="dcm-label">Errors</div>
          </div>
          <div class="dc-metric">
            <div class="dcm-val" style="color:${d.rate > 95 ? 'var(--green)' : 'var(--amber)'};">${d.rate}%</div>
            <div class="dcm-label">Norm Rate</div>
          </div>
        </div>

        <div class="dc-sparkline">
          <svg viewBox="0 0 280 32" preserveAspectRatio="none">
            <defs>
              <linearGradient id="sg-${d.id}" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stop-color="${d.color}" stop-opacity="0.3"/>
                <stop offset="100%" stop-color="${d.color}" stop-opacity="0"/>
              </linearGradient>
            </defs>
            <polygon points="0,32 ${pts} 280,32" fill="url(#sg-${d.id})"/>
            <polyline points="${pts}" fill="none" stroke="${d.color}" stroke-width="1.5" opacity="${d.status === 'running' ? '0.9' : '0.3'}"/>
            ${d.status === 'running' ? `<circle cx="${pts.split(' ').pop().split(',')[0]}" cy="${pts.split(' ').pop().split(',')[1]}" r="2.5" fill="${d.color}"/>` : ''}
          </svg>
        </div>

        <div class="dc-files">Files: ${(d.files || []).map(f => `<span>${f}</span>`).join(', ')}</div>

        <div class="dc-actions">
          ${d.status === 'running' ? `<button class="dc-btn pause"  onclick="pauseDash(${d.id})">⏸ Pause</button>` : ''}
          ${d.status === 'paused'  ? `<button class="dc-btn resume" onclick="startDash(${d.id})">▶ Resume</button>` : ''}
          ${d.status === 'stopped' ? `<button class="dc-btn resume" onclick="startDash(${d.id})">▶ Start</button>` : ''}
          ${d.status !== 'stopped' ? `<button class="dc-btn stop"   onclick="stopDash(${d.id})">■ Stop</button>` : ''}
          <a class="dc-btn" href="dashboard.html">View →</a>
        </div>
      </div>`;
  }).join('');
}

// ── LIST VIEW ──
function renderListRows() {
  document.getElementById('list-rows').innerHTML = dashboards.map(d => `
    <div class="list-row">
      <div class="lr-name">
        <span class="lr-dot" style="background:${d.color};box-shadow:0 0 4px ${d.color}55;"></span>
        <span class="lr-name-text">${d.name}</span>
      </div>

      <span class="lr-num" style="color:${d.color};">${d.events.toLocaleString()}</span>
      <span class="lr-num" style="color:${d.errors > 10 ? 'var(--red)' : 'var(--green)'};">${d.errors}</span>
      <span class="lr-num" style="color:${d.rate > 95 ? 'var(--green)' : 'var(--amber)'};">${d.rate}%</span>
      <span class="dc-status-badge status-${d.status}">${d.status}</span>
      <div class="lr-actions">
        ${d.status === 'running'
          ? `<button class="lr-btn" onclick="pauseDash(${d.id})">Pause</button>`
          : `<button class="lr-btn" onclick="startDash(${d.id})">Start</button>`}
        <button class="lr-btn" onclick="stopDash(${d.id})">Stop</button>
        <a class="lr-btn" href="dashboard.html" style="text-decoration:none;text-align:center;">View</a>
      </div>
    </div>`).join('');
}

// ── SYSTEM METRICS ──
function updateSystemMetrics() {
  const running = dashboards.filter(d => d.status === 'running').length;
  const total   = dashboards.length;
  const events  = dashboards.reduce((s, d) => s + d.events, 0);
  const errors  = dashboards.reduce((s, d) => s + d.errors, 0);
  const rate    = total ? Math.round(dashboards.reduce((s, d) => s + d.rate, 0) / total) : 0;
  const files   = dashboards.reduce((s, d) => s + (d.files || []).length, 0);

  animNum('sm-active', running);
  animNum('sm-events', events);
  animNum('sm-errors', errors);
  animNum('sm-files',  files);
  const rateEl = document.getElementById('sm-rate');
  if (rateEl) rateEl.textContent = rate + '%';

  setText('sm-active-sub', `${total} total groups`);
  setText('sm-events-sub', `↑ ${rand(2, 12)}% this session`);
  setText('sm-errors-sub', `${errors > 20 ? '↑ High' : '↓ Low'} error rate`);
  setText('sm-files-sub',  `across ${total} groups`);

  const rateSub = document.getElementById('sm-rate-sub');
  if (rateSub) { rateSub.className = rate > 95 ? 'up' : 'warn'; rateSub.textContent = rate > 95 ? 'Excellent' : 'Below target'; }

  setBar('smb-active', (running / Math.max(total, 1)) * 100);
  setBar('smb-events', Math.min(events / 5000 * 100, 100));
  setBar('smb-rate',   rate);
  setBar('smb-errors', Math.min(errors / 50 * 100, 100));
  setBar('smb-files',  Math.min(files / 10 * 100, 100));

  const navCount = document.getElementById('nav-running-count');
  if (navCount) navCount.textContent = running;
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function setBar(id, pct) {
  const el = document.getElementById(id);
  if (el) el.style.width = Math.round(pct) + '%';
}

function animNum(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  const start = parseInt(el.textContent.replace(/,/g, '')) || 0;
  const dur = 600; const t0 = performance.now();
  function step(now) {
    const p = Math.min((now - t0) / dur, 1);
    el.textContent = Math.floor(start + (target - start) * p).toLocaleString();
    if (p < 1) requestAnimationFrame(step);
    else el.textContent = target.toLocaleString();
  }
  requestAnimationFrame(step);
}

function updateRunningBadge() {
  const running = dashboards.filter(d => d.status === 'running').length;
  const badge   = document.getElementById('running-badge');
  if (!badge) return;
  badge.style.display = running > 0 ? 'inline-block' : 'none';
  badge.textContent   = `${running} running`;
}

// ── DASHBOARD CONTROLS ──
function startDash(id) {
  const d = dashboards.find(d => d.id === id);
  if (!d) return;
  d.status = 'running';
  pushLog(`"${d.name}" started`, 'success');
  renderAll();
}

function pauseDash(id) {
  const d = dashboards.find(d => d.id === id);
  if (!d) return;
  d.status = 'paused';
  pushLog(`"${d.name}" paused`, 'warn');
  renderAll();
}

function stopDash(id) {
  const d = dashboards.find(d => d.id === id);
  if (!d) return;
  d.status = 'stopped';
  pushLog(`"${d.name}" stopped`, 'warn');
  renderAll();
}

function startAll() {
  dashboards.forEach(d => d.status = 'running');
  pushLog('All dashboards started', 'success');
  renderAll();
}

function pauseAll() {
  dashboards.filter(d => d.status === 'running').forEach(d => d.status = 'paused');
  pushLog('All dashboards paused', 'warn');
  renderAll();
}

function stopAll() {
  dashboards.forEach(d => d.status = 'stopped');
  pushLog('All dashboards stopped', 'warn');
  renderAll();
}

function refreshAll() {
  dashboards.forEach(d => {
    if (d.status !== 'running') return;
    d.events += rand(5, 40);
    d.spark.push(rand(5, 100));
    d.spark.shift();
  });
  pushLog('All dashboards refreshed', 'info');
  renderAll();
}

function exportReport() {
  const lines = [
    'OCSF Log Mapper — Control Report',
    new Date().toISOString(),
    '',
    ...dashboards.map(d =>
      `${d.name} | ${d.status} | Events: ${d.events} | Errors: ${d.errors} | Rate: ${d.rate}%`
    ),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = 'ocsf_control_report.txt';
  a.click();
  pushLog('Report exported', 'info');
}

// ── VIEW TOGGLE ──
function setView(v, btn) {
  currentView = v;
  document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('cards-grid').style.display = v === 'grid' ? 'grid' : 'none';
  document.getElementById('cards-list').style.display = v === 'list' ? 'block' : 'none';
}

// ── ACTIVITY LOG ──
function pushLog(msg, type = 'info') {
  const time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  activityLog.unshift({ msg, type, time });
  if (activityLog.length > 80) activityLog.pop();
  renderLog();
}

function renderLog() {
  const feed = document.getElementById('activity-feed');
  if (!feed) return;
  feed.innerHTML = activityLog.map(e => `
    <div class="activity-entry">
      <div class="ae-time">${e.time}</div>
      <div class="ae-msg">${e.msg}<span class="ae-tag ae-${e.type}">${e.type}</span></div>
    </div>`).join('');
}

function clearLog() {
  activityLog = [];
  renderLog();
}

// ── SYSTEM HEALTH ──
function updateHealth() {
  const vals = { cpu: rand(18, 72), mem: rand(30, 65), spark: rand(60, 95), disk: rand(10, 45) };
  Object.entries(vals).forEach(([k, v]) => {
    const bar = document.getElementById(`h-${k}`);
    const pct = document.getElementById(`hp-${k}`);
    if (bar) bar.style.width = v + '%';
    if (pct) pct.textContent = v + '%';
  });
}

// ── CLOCK & UPTIME ──
function updateClock() {
  const tick = () => {
    const now = new Date();
    const timeEl = document.getElementById('cb-time');
    if (timeEl) timeEl.textContent =
      now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) +
      ' · ' + now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    const up  = Math.floor((Date.now() - startTime) / 1000);
    const h   = String(Math.floor(up / 3600)).padStart(2, '0');
    const m   = String(Math.floor((up % 3600) / 60)).padStart(2, '0');
    const s   = String(up % 60).padStart(2, '0');
    const uEl = document.getElementById('cb-uptime');
    if (uEl) uEl.textContent = `Uptime: ${h}:${m}:${s}`;
  };
  tick();
  setInterval(tick, 1000);
}

// ── AUTO TICK: simulate live ingestion ──
setInterval(() => {
  const running = dashboards.filter(d => d.status === 'running');
  running.forEach(d => {
    const inc = rand(1, 12);
    d.events += inc;
    d.spark.push(rand(5, 100));
    d.spark.shift();
    if (Math.random() < 0.25) {
      const msgs = [
        `"${d.name}" ingested ${inc} new events`,
        `"${d.name}" normalized batch — rate ${d.rate}%`,
        `New source IP detected in "${d.name}"`,
      ];
      pushLog(pick(msgs), 'info');
    }
  });
  if (running.length) {
    renderCards();
    renderListRows();
    updateSystemMetrics();
    updateHealth();
  }
}, 6000);

document.addEventListener('DOMContentLoaded', init);
