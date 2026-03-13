// ============================================================
//  OCSF LOG MAPPER — dashboard.js
//  Modes: 'file' (real OCSF data) | 'mock' (generated) | 'folder' (latest file)
// ============================================================

// ── OCSF MAPPINGS ──
const SEV_LABELS  = ['','Informational','Low','Medium','High','Critical'];
const SEV_COLORS  = { 1:'#3dd68c', 2:'#00c8e0', 3:'#f5a623', 4:'#e05252', 5:'#a855f7' };
const CLASS_COLOR = { 'Authentication':'#00c8e0','Account Change':'#f5a623','API Activity':'#3dd68c','Network Activity':'#a78bfa' };
const getClassColor = c => CLASS_COLOR[c] || '#8aa4b8';

// ── STATE ──
let groups       = [];
let activeGroup  = null;
let allEvents    = [];
let activeFilter = 'all';
let charts       = {};
let dashState    = {};
let currentMode  = 'file'; // 'file' | 'mock' | 'folder'
let folderFiles  = [];     // FileSystemFileEntry list from folder picker

// ── MOCK DATA ──
const MOCK_IPS   = ['203.0.113.50','198.51.100.22','192.0.2.14','10.0.1.45','172.16.0.88'];
const MOCK_USERS = ['alice','bob','carlos','diana','eve','frank'];
const MOCK_CLS   = ['Authentication','Account Change','API Activity','Network Activity'];
const MOCK_ACTS  = { 'Authentication':['Logon','Logoff','MFA'],'Account Change':['Create','Delete','Update'],'API Activity':['GetObject','PutObject','ListBuckets'],'Network Activity':['Allow','Deny'] };

function generateMockEvents(n = 60) {
  return Array.from({ length: n }, (_, i) => ({
    ts:       new Date(Date.now() - i * rand(30000,300000)),
    class:    pick(MOCK_CLS),
    activity: '',
    actor:    pick(MOCK_USERS),
    ip:       pick(MOCK_IPS),
    status:   Math.random() > 0.2 ? 'Success' : 'Failure',
    severity: rand(1,4),
    source:   'mock',
    category: '—',
  })).map(e => { e.activity = pick(MOCK_ACTS[e.class]); return e; });
}

// ── PARSE OCSF FROM RAW ──
function parseRawEvent(raw) {
  let ts;
  if (typeof raw.time === 'number') ts = new Date(raw.time > 1e10 ? raw.time : raw.time * 1000);
  else ts = new Date(raw.time);
  if (isNaN(ts)) ts = new Date();
  return {
    ts,
    class:    raw.class_name    || 'Unknown',
    activity: raw.activity_name || raw._schema || '—',
    actor:    raw.actor?.user?.name || raw.actor?.user?.uid || '—',
    ip:       raw.src_endpoint?.ip  || '—',
    status:   raw.status        || 'Unknown',
    severity: raw.severity_id   || 1,
    source:   raw._source       || '—',
    category: raw.category_name || '—',
  };
}

function parseOCSFText(text) {
  try {
    const raw = JSON.parse(text);
    return (Array.isArray(raw) ? raw : [raw]).map(parseRawEvent);
  } catch(e) { return []; }
}

// Deserialise stored events (ts is ISO string in localStorage)
function deserialiseStored(arr) {
  return (arr||[]).map(e => ({ ...e, ts: new Date(e.ts) }));
}

// ── LOAD EVENTS FOR ACTIVE GROUP ──
function loadGroupEvents() {
  if (currentMode === 'mock') {
    allEvents = generateMockEvents(60);
    return Promise.resolve();
  }

  if (currentMode === 'folder') {
    return loadLatestFolderFile();
  }

  // mode === 'file' — read from PARSED_EVENTS in localStorage
  if (!activeGroup) return Promise.resolve();
  const parsed    = Store.get(KEYS.PARSED_EVENTS) || {};
  const groupFileNames = activeGroup.files || [];

  let events = [];
  const reuploadNeeded = [];

  groupFileNames.forEach(fname => {
    const entry = parsed[fname];
    if (!entry) return;
    const storedEvents = deserialiseStored(entry.events || []);
    events = events.concat(storedEvents);
    if (entry.truncated) reuploadNeeded.push({ name: fname, loaded: entry.lsCount, total: entry.total });
  });

  allEvents = events.sort((a,b) => new Date(b.ts) - new Date(a.ts));

  // Show warning if any files were truncated
  if (reuploadNeeded.length) {
    const warn = document.getElementById('truncation-warning');
    if (warn) {
      warn.style.display = 'flex';
      warn.querySelector('.tw-text').textContent =
        reuploadNeeded.map(f => `${f.name}: showing ${f.loaded} of ${f.total} events`).join(' · ') +
        ' — re-upload on Upload page for full data';
    }
  } else {
    const warn = document.getElementById('truncation-warning');
    if (warn) warn.style.display = 'none';
  }

  return Promise.resolve();
}

// ── FOLDER MODE: pick folder, find latest timestamped file ──
function pickFolder() {
  const input = document.createElement('input');
  input.type = 'file';
  input.webkitdirectory = true;
  input.multiple = true;
  input.accept = '.json';
  input.onchange = async (e) => {
    const files = Array.from(e.target.files).filter(f => f.name.endsWith('.json'));
    if (!files.length) { showBanner('No JSON files found in folder', 'error'); return; }

    // Sort by filename — timestamps in name like events_20260313_123809.json
    // Also fall back to lastModified date
    files.sort((a, b) => {
      // Try extracting timestamp from filename
      const tsA = extractTimestamp(a.name);
      const tsB = extractTimestamp(b.name);
      if (tsA && tsB) return tsB - tsA;
      return b.lastModified - a.lastModified;
    });

    const latest = files[0];
    folderFiles  = files;

    document.getElementById('folder-file-name').textContent = latest.name;
    document.getElementById('folder-file-count').textContent = `${files.length} JSON files found`;

    const text   = await latest.text();
    allEvents    = parseOCSFText(text);
    renderDashboard();
    showBanner(`Loaded latest file: ${latest.name} — ${allEvents.length} events`, 'success');
  };
  input.click();
}

function extractTimestamp(filename) {
  // Match patterns like: events_20260313_123809.json or 2026-03-13T12-38-09.json
  const m = filename.match(/(\d{8})[_\-](\d{6})/);
  if (m) {
    const d = m[1], t = m[2];
    return new Date(`${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}T${t.slice(0,2)}:${t.slice(2,4)}:${t.slice(4,6)}`);
  }
  return null;
}

function loadLatestFolderFile() {
  if (!folderFiles.length) {
    allEvents = [];
    return Promise.resolve();
  }
  return folderFiles[0].text().then(text => {
    allEvents = parseOCSFText(text);
  });
}

// ── PERSISTENCE ──
function saveDashState() {
  if (!activeGroup) return;
  dashState[activeGroup.id] = {
    events: allEvents.map(e => ({ ...e, ts: e.ts instanceof Date ? e.ts.toISOString() : e.ts })),
    mode:   currentMode
  };
  Store.set(KEYS.DASH_STATE, dashState);
}
function loadDashState() { dashState = Store.get(KEYS.DASH_STATE) || {}; }

// ── INIT ──
function init() {
  loadDashState();
  groups = Store.get(KEYS.GROUPS);

  if (!groups || !groups.length) {
    document.getElementById('no-group-overlay').classList.add('visible');
    return;
  }

  document.getElementById('dash-layout').style.display = 'grid';
  renderGroupSidebar();

  let startGroup = groups[0];
  const activeRaw = Store.get(KEYS.ACTIVE_GROUP);
  if (activeRaw) {
    const match = groups.find(g => String(g.id) === String(activeRaw.id));
    if (match) startGroup = match;
    Store.remove(KEYS.ACTIVE_GROUP);
  }

  switchGroup(startGroup);
}

// ── SIDEBAR ──
function renderGroupSidebar() {
  document.getElementById('group-list').innerHTML = groups.map(g => `
    <li>
      <a class="group-item ${activeGroup?.id === g.id ? 'active' : ''}"
         onclick="switchGroup(${JSON.stringify(g).replace(/"/g,'&quot;')})" href="#">
        <span class="gi-dot" style="background:${g.color};box-shadow:0 0 5px ${g.color}55;"></span>
        <div class="gi-info">
          <div class="gi-name">${g.name}</div>
          <div class="gi-count">${(g.files||[]).length} file${(g.files||[]).length!==1?'s':''}</div>
        </div>
        <span class="gi-status"></span>
      </a>
    </li>`).join('');
}

// ── SWITCH GROUP ──
function switchGroup(g) {
  if (activeGroup) saveDashState();
  activeGroup  = g;
  activeFilter = 'all';

  // Restore saved mode for this group if exists
  const saved = dashState[g.id];
  if (saved && saved.mode) {
    currentMode = saved.mode;
    updateModeToggle();
  }

  renderGroupSidebar();
  renderTopbar();
  loadGroupEvents().then(() => renderDashboard());
}

function renderDashboard() {
  renderKPIs();
  renderCharts();
  renderEventLog();
  saveDashState();
}

// ── MODE TOGGLE ──
function setMode(mode) {
  currentMode = mode;
  updateModeToggle();

  // For folder mode, show folder picker UI
  const folderPicker = document.getElementById('folder-picker-bar');
  if (folderPicker) folderPicker.style.display = mode === 'folder' ? 'flex' : 'none';

  loadGroupEvents().then(() => renderDashboard());
}

function updateModeToggle() {
  document.querySelectorAll('.mode-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === currentMode);
  });
}

// ── TOP BAR ──
function renderTopbar() {
  const color = activeGroup.color;
  document.getElementById('dt-color').style.cssText  = `background:${color};box-shadow:0 0 6px ${color}77;`;
  document.getElementById('dt-name').textContent      = activeGroup.name;
  document.getElementById('dt-files').textContent     =
    `${(activeGroup.files||[]).length} file${(activeGroup.files||[]).length!==1?'s':''}`;
}

// ── BANNER (inline notification) ──
function showBanner(msg, type) {
  const b = document.getElementById('dash-banner');
  if (!b) return;
  b.textContent  = msg;
  b.className    = `dash-banner ${type}`;
  b.style.display = 'block';
  clearTimeout(b._t);
  b._t = setTimeout(() => { b.style.display = 'none'; }, 4000);
}

// ── KPIs ──
function renderKPIs() {
  const total  = allEvents.length;
  const norm   = allEvents.filter(e => e.class !== 'Unknown').length;
  const errors = allEvents.filter(e => e.status === 'Failure').length;
  const ips    = new Set(allEvents.map(e => e.ip).filter(ip => ip && ip !== '—')).size;

  animateNum('kpi-total', total);
  animateNum('kpi-norm',  norm);
  animateNum('kpi-err',   errors);
  animateNum('kpi-ip',    ips);

  const normRate = total ? ((norm/total)*100).toFixed(1) : '0.0';
  document.getElementById('kpi-total-delta').textContent = `${total} total events`;
  document.getElementById('kpi-norm-delta').textContent  = `${normRate}% normalization rate`;
  document.getElementById('kpi-err-delta').textContent   = `${errors} failure events`;
  document.getElementById('kpi-ip-delta').textContent    = `${ips} unique source IPs`;

  // Sparklines from real data — events per hour
  const hourBuckets = buildHourBuckets(allEvents, 12);
  drawSparkline('spark-total', hourBuckets, '#00c8e0');
  drawSparkline('spark-norm',  hourBuckets.map(v => Math.round(v * parseFloat(normRate)/100)), '#3dd68c');
  drawSparkline('spark-err',   buildSeverityTrend(allEvents, 12), '#e05252');
  drawSparkline('spark-ip',    buildIPTrend(allEvents, 12), '#f5a623');
}

function buildHourBuckets(events, n) {
  if (!events.length) return Array(n).fill(0);
  const buckets = Array(n).fill(0);
  const now = Date.now();
  const windowMs = n * 60 * 60 * 1000;
  events.forEach(e => {
    const age = now - new Date(e.ts);
    const idx = Math.floor((age / windowMs) * n);
    if (idx >= 0 && idx < n) buckets[n - 1 - idx]++;
  });
  return buckets;
}
function buildSeverityTrend(events, n) {
  const high = events.filter(e => e.severity >= 3);
  return buildHourBuckets(high, n);
}
function buildIPTrend(events, n) {
  const buckets = Array(n).fill(0);
  const now = Date.now();
  const windowMs = n * 60 * 60 * 1000;
  events.forEach(e => {
    const age = now - new Date(e.ts);
    const idx = Math.floor((age / windowMs) * n);
    if (idx >= 0 && idx < n) {
      buckets[n - 1 - idx] = new Set([
        ...(buckets[n-1-idx] instanceof Set ? buckets[n-1-idx] : []),
        e.ip
      ]);
    }
  });
  return buckets.map(b => b instanceof Set ? b.size : b);
}

function animateNum(id, target) {
  const el = document.getElementById(id);
  const dur = 700, t0 = performance.now();
  (function step(now) {
    const p = Math.min((now-t0)/dur, 1);
    el.textContent = Math.floor(p*target).toLocaleString();
    if (p < 1) requestAnimationFrame(step);
    else el.textContent = target.toLocaleString();
  })(performance.now());
}

function drawSparkline(id, data, color) {
  const svg = document.getElementById(id);
  if (!svg) return;
  const w = 120, h = 28;
  const max = Math.max(...data, 1);
  const pts = data.map((v,i) => `${(i/(data.length-1))*w},${h-(v/max)*(h-4)-2}`).join(' ');
  svg.innerHTML = `
    <defs><linearGradient id="g-${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${color}"/>
      <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
    </linearGradient></defs>
    <polygon points="0,${h} ${pts} ${w},${h}" fill="url(#g-${id})" opacity="0.15"/>
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" opacity="0.8"/>`;
}

// ── CHARTS ──
Chart.defaults.color       = '#3a5060';
Chart.defaults.borderColor = '#151f2b';
Chart.defaults.font.family = "'IBM Plex Mono', monospace";
Chart.defaults.font.size   = 10;
const TT = { backgroundColor:'#090e14', borderColor:'#1e2e40', borderWidth:1, titleColor:'#ddeeff', bodyColor:'#8aa4b8' };

function renderCharts() { renderVolumeChart(); renderClassChart(); renderSeverityChart(); renderIPBars(); }

function renderVolumeChart() {
  const hours  = 24;
  const buckets = Array(hours).fill(0);
  const now    = Date.now();
  allEvents.forEach(e => {
    const h = Math.floor((now - new Date(e.ts)) / 3600000);
    if (h >= 0 && h < hours) buckets[hours - 1 - h]++;
  });
  const labels = Array.from({length:hours},(_,i)=> `${String(i).padStart(2,'0')}:00`);
  const ctx = document.getElementById('chart-volume').getContext('2d');
  if (charts.volume) charts.volume.destroy();
  charts.volume = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: [{
      data: buckets, borderColor: activeGroup.color,
      backgroundColor: activeGroup.color+'14', borderWidth:1.5,
      fill:true, tension:0.4, pointRadius:0, pointHoverRadius:4,
    }]},
    options: { responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false}, tooltip:{...TT, callbacks:{label:c=>`  ${c.parsed.y} events`}}},
      scales:{ x:{grid:{color:'#151f2b'},ticks:{maxTicksLimit:8}}, y:{grid:{color:'#151f2b'},beginAtZero:true}}
    }
  });
}

function renderClassChart() {
  const classNames = [...new Set(allEvents.map(e => e.class))].filter(Boolean);
  const counts     = classNames.map(c => allEvents.filter(e => e.class === c).length);
  const colors     = classNames.map(c => getClassColor(c));
  const ctx = document.getElementById('chart-classes').getContext('2d');
  if (charts.classes) charts.classes.destroy();
  charts.classes = new Chart(ctx, {
    type: 'doughnut',
    data: { labels: classNames, datasets: [{
      data: counts, backgroundColor: colors.map(c=>c+'cc'),
      borderColor: colors, borderWidth:1, hoverOffset:4
    }]},
    options: { responsive:true, maintainAspectRatio:true, cutout:'68%',
      plugins:{ legend:{display:false}, tooltip:TT }
    }
  });
  const total = counts.reduce((a,b)=>a+b,0);
  document.getElementById('class-legend').innerHTML = classNames.map((c,i)=>`
    <div style="display:flex;align-items:center;gap:0.6rem;margin-bottom:0.7rem;padding:0.5rem 0.6rem;border:1px solid var(--border);">
      <span style="width:8px;height:8px;border-radius:50%;background:${colors[i]};flex-shrink:0;box-shadow:0 0 5px ${colors[i]}55;"></span>
      <span style="flex:1;font-family:var(--sans);font-size:0.72rem;color:var(--text);">${c}</span>
      <span style="font-size:0.68rem;color:var(--cyan);">${counts[i]}</span>
      <span style="font-size:0.6rem;color:var(--dim);">${total?Math.round(counts[i]/total*100):0}%</span>
    </div>`).join('');
}

function renderSeverityChart() {
  const sevCounts = [1,2,3,4,5].map(s => allEvents.filter(e=>e.severity===s).length);
  const sevLabels = ['Info','Low','Medium','High','Critical'];
  const sevClrs   = ['#3dd68c','#00c8e0','#f5a623','#e05252','#a855f7'];
  const ctx = document.getElementById('chart-severity').getContext('2d');
  if (charts.severity) charts.severity.destroy();
  charts.severity = new Chart(ctx, {
    type: 'bar',
    data: { labels: sevLabels, datasets: [{
      data: sevCounts, backgroundColor: sevClrs.map(c=>c+'22'),
      borderColor: sevClrs, borderWidth:1
    }]},
    options: { responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false}, tooltip:TT },
      scales:{ x:{grid:{display:false}}, y:{grid:{color:'#151f2b'},beginAtZero:true}}
    }
  });
}

function renderIPBars() {
  const ipMap  = {};
  allEvents.forEach(e => { if(e.ip && e.ip!=='—') ipMap[e.ip]=(ipMap[e.ip]||0)+1; });
  const sorted = Object.entries(ipMap).sort((a,b)=>b[1]-a[1]).slice(0,8);
  const max    = sorted[0]?.[1]||1;
  document.getElementById('ip-bars').innerHTML = sorted.map(([ip,count])=>`
    <div style="display:flex;align-items:center;gap:1rem;margin-bottom:0.6rem;">
      <span style="font-family:var(--mono);font-size:0.72rem;color:var(--text);width:130px;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${ip}</span>
      <div style="flex:1;height:18px;background:var(--surface);border:1px solid var(--border);position:relative;overflow:hidden;">
        <div style="position:absolute;top:0;left:0;height:100%;width:${(count/max*100).toFixed(1)}%;
          background:linear-gradient(90deg,${activeGroup.color}44,${activeGroup.color}22);
          border-right:1px solid ${activeGroup.color}88;transition:width 0.6s;"></div>
      </div>
      <span style="font-family:var(--display);font-size:0.95rem;color:${activeGroup.color};width:36px;text-align:right;">${count}</span>
    </div>`).join('');
}

// ── EVENT LOG ──
function renderEventLog() {
  const filtered = activeFilter === 'all'
    ? allEvents
    : allEvents.filter(e => e.class === activeFilter);

  document.getElementById('event-tbody').innerHTML = filtered.slice(0,20).map(e => {
    const color = getClassColor(e.class);
    const ts    = e.ts instanceof Date ? e.ts : new Date(e.ts);
    const sevColor = SEV_COLORS[e.severity] || '#8aa4b8';
    return `<tr>
      <td style="color:var(--dim);white-space:nowrap;">${isNaN(ts)?'—':ts.toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'})}</td>
      <td><span style="font-size:0.65rem;padding:0.1rem 0.4rem;border:1px solid;color:${color};border-color:${color}44;">${e.class}</span></td>
      <td style="color:var(--text);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${e.activity}</td>
      <td style="color:var(--bright);">${e.actor}</td>
      <td style="color:var(--dim);">${e.ip}</td>
      <td style="color:var(--dim);font-size:0.65rem;">${e.source}</td>
      <td class="${e.status==='Success'?'status-ok':'status-err'}">${e.status}</td>
      <td><span class="sev-badge" style="color:${sevColor};border-color:${sevColor}44;">${SEV_LABELS[e.severity]||e.severity}</span></td>
    </tr>`;
  }).join('');
}

function filterLog(btn, cls) {
  activeFilter = cls;
  document.querySelectorAll('.lf-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  renderEventLog();
}

function setRange(btn) {
  document.querySelectorAll('.tr-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  loadGroupEvents().then(()=>renderDashboard());
}

function toggleChartType(btn, type) {
  btn.closest('.chart-cell').querySelectorAll('.chart-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  if (charts.volume) {
    charts.volume.config.type = type==='vol-bar'?'bar':'line';
    charts.volume.data.datasets[0].fill = type!=='vol-bar';
    charts.volume.update();
  }
}

document.addEventListener('DOMContentLoaded', init);
