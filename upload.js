// ============================================================
//  OCSF LOG MAPPER — upload.js
//  Used by: upload.html
//  Depends on: shared.js
// ============================================================

// ── CONSTANTS ──
const GROUP_COLORS = ['#00c8e0','#f5a623','#3dd68c','#e05252','#a78bfa','#fb7185','#34d399','#60a5fa'];
const MAX_LS_BYTES = 4.5 * 1024 * 1024; // 4.5MB safe threshold for localStorage

// ── STATE ──
let files       = [];
let groups      = [];
let selectedIds = new Set();
let dragFileId  = null;

// In-memory store for large file remainder (lost on refresh)
// { [filename]: parsedEvents[] }
const memoryEvents = {};

// ── FILE READING & SMART STORAGE ──

// Parse raw OCSF event into normalised object
function parseOCSFEvent(raw) {
  let ts;
  if (typeof raw.time === 'number') {
    ts = new Date(raw.time > 1e10 ? raw.time : raw.time * 1000);
  } else {
    ts = new Date(raw.time);
  }
  if (isNaN(ts)) ts = new Date();

  return {
    ts:       ts.toISOString(),
    class:    raw.class_name    || 'Unknown',
    uid:      raw.class_uid     || 0,
    activity: raw.activity_name || raw._schema || '—',
    actor:    raw.actor?.user?.name || raw.actor?.user?.uid || '—',
    ip:       raw.src_endpoint?.ip  || '—',
    status:   raw.status        || 'Unknown',
    severity: raw.severity_id   || 1,
    source:   raw._source       || '—',
    category: raw.category_name || '—',
  };
}

function readAndStoreFile(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      let allEvents = [];

      try {
        const raw = JSON.parse(text);
        const arr = Array.isArray(raw) ? raw : [raw];
        allEvents = arr.map(parseOCSFEvent);
      } catch(err) {
        console.warn('JSON parse error for', file.name, err);
        resolve({ filename: file.name, total: 0, truncated: false, stored: 'none' });
        return;
      }

      const totalEvents = allEvents.length;
      const jsonStr     = JSON.stringify(allEvents);
      const byteSize    = new Blob([jsonStr]).size;

      const parsed = Store.get(KEYS.PARSED_EVENTS) || {};

      if (byteSize <= MAX_LS_BYTES) {
        // ── Small file: store everything in localStorage ──
        parsed[file.name] = { events: allEvents, truncated: false, total: totalEvents, stored: 'full' };
        Store.set(KEYS.PARSED_EVENTS, parsed);
        resolve({ filename: file.name, total: totalEvents, truncated: false, stored: 'full' });

      } else {
        // ── Large file: calculate how many events fit in 4.5MB ──
        let sliceCount = 0;
        let runningSize = 2; // for '[]'
        for (let i = 0; i < allEvents.length; i++) {
          const eventSize = JSON.stringify(allEvents[i]).length + 1; // +1 for comma
          if (runningSize + eventSize > MAX_LS_BYTES) break;
          runningSize += eventSize;
          sliceCount++;
        }

        const lsEvents  = allEvents.slice(0, sliceCount);
        const memEvents = allEvents.slice(sliceCount);

        // Save first chunk to localStorage
        parsed[file.name] = {
          events:    lsEvents,
          truncated: true,
          total:     totalEvents,
          lsCount:   sliceCount,
          stored:    'partial'
        };
        Store.set(KEYS.PARSED_EVENTS, parsed);

        // Save remainder in memory
        memoryEvents[file.name] = memEvents;

        resolve({ filename: file.name, total: totalEvents, truncated: true, stored: 'partial', lsCount: sliceCount });
      }
    };
    reader.onerror = () => resolve({ filename: file.name, total: 0, truncated: false, stored: 'none' });
    reader.readAsText(file);
  });
}

// Get all events for a filename — combines localStorage + memory remainder
function getEventsForFile(filename) {
  const parsed = Store.get(KEYS.PARSED_EVENTS) || {};
  const entry  = parsed[filename];
  if (!entry) return { events: [], truncated: false, needsReupload: false };

  if (!entry.truncated) {
    return { events: entry.events, truncated: false, needsReupload: false };
  }

  // Truncated — check if memory has remainder
  const memRemainder = memoryEvents[filename] || [];
  const allEvents    = [...entry.events, ...memRemainder];
  const needsReupload = memRemainder.length === 0; // memory cleared (page refreshed)

  return {
    events:       allEvents,
    truncated:    true,
    lsCount:      entry.lsCount,
    total:        entry.total,
    needsReupload,
    loaded:       allEvents.length
  };
}

// Get all events for a group (merges all files in group)
function getEventsForGroup(groupId) {
  const groupFiles = files.filter(f => f.group === groupId);
  let allEvents    = [];
  let anyTruncated = false;
  let reuploadNeeded = [];

  groupFiles.forEach(f => {
    const result = getEventsForFile(f.name);
    allEvents = allEvents.concat(result.events);
    if (result.truncated) {
      anyTruncated = true;
      if (result.needsReupload) reuploadNeeded.push(f.name);
    }
  });

  return { events: allEvents, anyTruncated, reuploadNeeded };
}

// ── PERSISTENCE ──
function saveState() {
  const serialisable = files.map(({ fileObj, date, ...rest }) => ({
    ...rest,
    date: date instanceof Date ? date.toISOString() : date
  }));
  Store.set(KEYS.FILES,        serialisable);
  Store.set(KEYS.DRAFT_GROUPS, groups.map(({ open, ...g }) => g));

  const hasPublishable = groups.some(g => files.some(f => f.group === g.id));
  if (!groups.length || !hasPublishable) {
    Store.remove(KEYS.GROUPS);
    Store.remove(KEYS.DASH_STATE);
  }
}

function loadState() {
  const rawFiles  = Store.get(KEYS.FILES);
  const rawGroups = Store.get(KEYS.DRAFT_GROUPS);
  if (rawFiles)  files  = rawFiles.map(f => ({ ...f, date: new Date(f.date), fileObj: null }));
  if (rawGroups) groups = rawGroups.map(g => ({ ...g, open: true }));
}

// ── DROPZONE ──
function initDropzone() {
  const dropzone = document.getElementById('dropzone');
  if (!dropzone) return;

  dropzone.addEventListener('dragover',  e => { e.preventDefault(); dropzone.classList.add('dragover'); });
  dropzone.addEventListener('dragleave', ()  => dropzone.classList.remove('dragover'));
  dropzone.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    handleFiles(Array.from(e.dataTransfer.files));
  });
  dropzone.addEventListener('click', e => {
    if (e.target.classList.contains('dz-btn')) return;
    document.getElementById('file-input').click();
  });
  document.getElementById('file-input').addEventListener('change', e => {
    handleFiles(Array.from(e.target.files));
    e.target.value = '';
  });
}

function handleFiles(newFiles) {
  if (!newFiles.length) return;

  const prog = document.getElementById('upload-progress');
  const fill = document.getElementById('upload-progress-fill');
  prog.style.display = 'block';

  let i = 0;
  const interval = setInterval(() => {
    i += Math.random() * 25;
    fill.style.width = Math.min(i, 95) + '%';
  }, 80);

  const parsePromises = [];
  let added = 0;

  newFiles.forEach(f => {
    if (files.find(x => x.name === f.name)) return;
    files.push({
      id:      Date.now() + Math.random(),
      name:    f.name,
      size:    f.size,
      type:    f.type || 'application/json',
      date:    new Date(),
      group:   null,
      fileObj: f,
    });
    added++;
    parsePromises.push(readAndStoreFile(f));
  });

  Promise.all(parsePromises).then(results => {
    clearInterval(interval);
    fill.style.width = '100%';
    setTimeout(() => { prog.style.display = 'none'; fill.style.width = '0%'; }, 400);

    if (!added) {
      showToast('File already uploaded — skipped duplicate', 'error');
      return;
    }

    let msg = `${added} file${added > 1 ? 's' : ''} uploaded`;
    const totalEvents = results.reduce((s, r) => s + (r.total || 0), 0);
    msg += ` — ${totalEvents} events parsed`;

    const truncated = results.filter(r => r.truncated);
    if (truncated.length) {
      msg += ` (${truncated.length} file${truncated.length > 1 ? 's' : ''} partially stored — >5MB)`;
    }

    renderTable();
    saveState();
    showToast(msg, 'success');
  });
}

// ── RE-UPLOAD HANDLER (for large files after refresh) ──
function promptReupload(filenames) {
  const nameList = filenames.join(', ');
  showToast(`Re-upload needed for full data: ${nameList}`, 'error');

  // Highlight those files in the table
  filenames.forEach(name => {
    const f = files.find(f => f.name === name);
    if (f) {
      const row = document.querySelector(`tr[data-id="${f.id}"]`);
      if (row) row.classList.add('needs-reupload');
    }
  });
}

// ── TABLE RENDER ──
function renderTable() {
  const tbody   = document.getElementById('file-tbody');
  const table   = document.getElementById('file-table');
  const empty   = document.getElementById('empty-state');
  const countEl = document.getElementById('file-count');

  const query = (document.getElementById('search-box')?.value || '').toLowerCase();
  let visible = files.filter(f => f.name.toLowerCase().includes(query));

  const sort = document.getElementById('sort-select')?.value || 'date-desc';
  visible.sort((a, b) => {
    if (sort === 'date-desc') return new Date(b.date) - new Date(a.date);
    if (sort === 'date-asc')  return new Date(a.date) - new Date(b.date);
    if (sort === 'name-asc')  return a.name.localeCompare(b.name);
    if (sort === 'size-desc') return b.size - a.size;
    return 0;
  });

  countEl.textContent = files.length + ' file' + (files.length !== 1 ? 's' : '');

  if (!files.length) {
    empty.classList.add('visible');
    table.style.display = 'none';
    updateBulkBar();
    updateProcessBtn();
    return;
  }

  empty.classList.remove('visible');
  table.style.display = 'table';

  // Check which files need re-upload
  const parsed = Store.get(KEYS.PARSED_EVENTS) || {};

  tbody.innerHTML = visible.map(f => {
    const grp      = groups.find(g => g.id === f.group);
    const sel      = selectedIds.has(f.id) ? 'selected' : '';
    const grpBadge = grp
      ? `<span style="font-size:0.6rem;color:${grp.color};border:1px solid ${grp.color}33;padding:0.15rem 0.4rem;white-space:nowrap;">${grp.name}</span>`
      : `<span style="font-size:0.6rem;color:var(--dim);">—</span>`;

    const pEntry   = parsed[f.name];
    const isTrunc  = pEntry?.truncated;
    const memOk    = memoryEvents[f.name]?.length > 0;
    let statusBadge = '';
    if (pEntry) {
      if (!isTrunc) {
        statusBadge = `<span class="parse-badge full" title="${pEntry.total} events">✓ ${pEntry.total} events</span>`;
      } else if (memOk) {
        statusBadge = `<span class="parse-badge partial" title="${pEntry.total} events total, full in memory">⚡ ${pEntry.total} events</span>`;
      } else {
        statusBadge = `<span class="parse-badge reupload" title="Re-upload for full data" onclick="reuploadFile('${f.id}')">⚠ ${pEntry.lsCount}/${pEntry.total} — re-upload</span>`;
      }
    }

    return `
      <tr class="${sel}" draggable="true" data-id="${f.id}"
          ondragstart="rowDragStart(event, '${f.id}')"
          onclick="rowClick(event, '${f.id}')">
        <td><input type="checkbox" ${sel ? 'checked' : ''} onchange="toggleRow('${f.id}')" onclick="event.stopPropagation()"></td>
        <td>
          <span class="file-icon">${fileIcon(f.name)}</span>
          <span class="file-name">${f.name}</span>
          <span class="file-path">${formatDate(f.date)}</span>
          ${statusBadge}
        </td>
        <td class="file-size">${formatSize(f.size)}</td>
        <td class="file-date">${timeAgo(f.date)}</td>
        <td>${grpBadge}</td>
        <td>
          <div class="row-actions">
            <button class="row-btn" onclick="event.stopPropagation(); assignFileToGroupPrompt('${f.id}')">Assign</button>
            <button class="row-btn danger" onclick="event.stopPropagation(); deleteFile('${f.id}')">✕</button>
          </div>
        </td>
      </tr>`;
  }).join('');

  updateBulkBar();
  updateProcessBtn();
}

// Re-upload a specific large file to restore full memory content
function reuploadFile(fileId) {
  const f = files.find(f => String(f.id) === String(fileId));
  if (!f) return;
  const input = document.createElement('input');
  input.type   = 'file';
  input.accept = '.json,.jsonl';
  input.onchange = async (e) => {
    const newFile = e.target.files[0];
    if (!newFile) return;
    if (newFile.name !== f.name) {
      showToast(`Wrong file — please select "${f.name}"`, 'error');
      return;
    }
    f.fileObj = newFile;
    const result = await readAndStoreFile(newFile);
    showToast(`Re-loaded: ${result.total} events now available`, 'success');
    renderTable();
  };
  input.click();
}

// ── SELECTION ──
function rowClick(e, id) {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON' || e.target.classList.contains('parse-badge')) return;
  toggleRow(id);
}
function toggleRow(id) {
  const f = files.find(f => String(f.id) === String(id));
  if (!f) return;
  if (selectedIds.has(f.id)) selectedIds.delete(f.id);
  else selectedIds.add(f.id);
  renderTable();
}
function toggleSelectAll(cb) {
  if (cb.checked) files.forEach(f => selectedIds.add(f.id));
  else selectedIds.clear();
  renderTable();
}
function clearSelection() { selectedIds.clear(); renderTable(); }
function updateBulkBar() {
  const bar = document.getElementById('bulk-bar');
  const cnt = document.getElementById('bulk-count');
  if (!bar) return;
  if (selectedIds.size > 0) {
    bar.classList.add('visible');
    cnt.textContent = selectedIds.size + ' file' + (selectedIds.size > 1 ? 's' : '') + ' selected';
  } else { bar.classList.remove('visible'); }
}

function deleteSelected() {
  files.filter(f => selectedIds.has(f.id)).forEach(f => cleanupFile(f.name));
  files = files.filter(f => !selectedIds.has(f.id));
  selectedIds.clear();
  renderTable(); renderGroups(); saveState();
  showToast('Files removed', 'success');
}
function deleteFile(id) {
  const f = files.find(f => String(f.id) === String(id));
  if (f) cleanupFile(f.name);
  files = files.filter(f => String(f.id) !== String(id));
  selectedIds.delete(parseFloat(id));
  renderTable(); renderGroups(); saveState();
}
function cleanupFile(filename) {
  delete memoryEvents[filename];
  const parsed = Store.get(KEYS.PARSED_EVENTS) || {};
  delete parsed[filename];
  Store.set(KEYS.PARSED_EVENTS, parsed);
}

function filterFiles() { renderTable(); }
function sortFiles()   { renderTable(); }

// ── GROUPS ──
function createGroup() {
  const name = document.getElementById('new-group-name').value.trim();
  if (!name) { showToast('Enter a group name', 'error'); return; }
  if (groups.find(g => g.name === name)) { showToast('Group name already exists', 'error'); return; }
  groups.push({ id: Date.now(), name, color: GROUP_COLORS[groups.length % GROUP_COLORS.length], open: true });
  document.getElementById('new-group-name').value = '';
  renderGroups(); renderTable(); updateProcessBtn(); saveState();
  showToast(`Group "${name}" created`, 'success');
}

function renderGroups() {
  const list     = document.getElementById('groups-list');
  const noMsg    = document.getElementById('no-groups-msg');
  const countTag = document.getElementById('group-count-tag');
  if (countTag) countTag.textContent = groups.length + ' group' + (groups.length !== 1 ? 's' : '');
  if (!groups.length) {
    list.innerHTML = '';
    if (noMsg) noMsg.style.display = 'block';
    return;
  }
  if (noMsg) noMsg.style.display = 'none';
  list.innerHTML = groups.map(g => {
    const gf = files.filter(f => f.group === g.id);
    return `
      <div class="group-card" id="gc-${g.id}"
           ondragover="gcDragOver(event,'${g.id}')" ondragleave="gcDragLeave('${g.id}')" ondrop="gcDrop(event,'${g.id}')">
        <div class="gc-header" onclick="toggleGroup('${g.id}')">
          <span class="gc-color" style="background:${g.color};box-shadow:0 0 6px ${g.color}44;"></span>
          <span class="gc-name">${g.name}</span>
          <span class="gc-count">${gf.length} file${gf.length !== 1 ? 's' : ''}</span>
          <span class="gc-chevron ${g.open ? 'open' : ''}">▶</span>
        </div>
        <div class="gc-files ${g.open ? 'open' : ''}">
          ${gf.length
            ? gf.map(f => `<div class="gc-file-item">
                <span class="gc-file-name">${fileIcon(f.name)} ${f.name}</span>
                <span class="gc-file-remove" onclick="removeFromGroup('${f.id}')">✕</span>
              </div>`).join('')
            : `<div class="gc-empty">No files yet — drag rows here or use Assign</div>`}
        </div>
        <div class="gc-footer">
          <button class="row-btn" onclick="openGroupDashboard('${g.id}')">Dashboard →</button>
          <button class="row-btn danger" onclick="deleteGroup('${g.id}')">✕</button>
        </div>
      </div>`;
  }).join('');
}

function toggleGroup(id) {
  const g = groups.find(g => String(g.id) === String(id));
  if (g) { g.open = !g.open; renderGroups(); }
}
function deleteGroup(id) {
  const gid = parseFloat(id);
  files.forEach(f => { if (f.group === gid) f.group = null; });
  groups = groups.filter(g => String(g.id) !== String(id));
  renderGroups(); renderTable(); updateProcessBtn(); saveState();
  showToast('Group removed', 'success');
}
function removeFromGroup(fileId) {
  const f = files.find(f => String(f.id) === String(fileId));
  if (f) { f.group = null; renderTable(); renderGroups(); saveState(); }
}
function assignSelectedToGroup() {
  if (!groups.length) { showToast('Create a group first', 'error'); return; }
  const gName = prompt('Assign to group:\n' + groups.map(g => g.name).join(', '));
  if (!gName) return;
  const grp = groups.find(g => g.name === gName);
  if (!grp) { showToast('Group not found', 'error'); return; }
  selectedIds.forEach(id => { const f = files.find(f => f.id === id); if (f) f.group = grp.id; });
  selectedIds.clear();
  renderTable(); renderGroups(); saveState();
  showToast(`Assigned to "${grp.name}"`, 'success');
}
function assignFileToGroupPrompt(fileId) {
  if (!groups.length) { showToast('Create a group first', 'error'); return; }
  const gName = prompt('Assign to group:\n' + groups.map(g => g.name).join(', '));
  if (!gName) return;
  const grp = groups.find(g => g.name === gName);
  if (!grp) return;
  const f = files.find(f => String(f.id) === String(fileId));
  if (f) { f.group = grp.id; renderTable(); renderGroups(); saveState(); showToast(`Assigned to "${grp.name}"`, 'success'); }
}

// ── DRAG & DROP ──
function rowDragStart(e, id) { dragFileId = id; e.dataTransfer.effectAllowed = 'move'; }
function gcDragOver(e, gid)  { e.preventDefault(); document.getElementById('gc-'+gid)?.classList.add('drop-target'); }
function gcDragLeave(gid)    { document.getElementById('gc-'+gid)?.classList.remove('drop-target'); }
function gcDrop(e, gid) {
  e.preventDefault();
  document.getElementById('gc-'+gid)?.classList.remove('drop-target');
  if (!dragFileId) return;
  const grp = groups.find(g => String(g.id) === String(gid));
  const f   = files.find(f => String(f.id) === String(dragFileId));
  if (grp && f) { f.group = grp.id; renderTable(); renderGroups(); saveState(); showToast(`"${f.name}" added to "${grp.name}"`, 'success'); }
  dragFileId = null;
}

// ── NAVIGATION ──
function updateProcessBtn() {
  const btn = document.getElementById('process-btn');
  if (btn) btn.disabled = !files.some(f => f.group !== null);
}

function publishGroups(grouped) {
  Store.set(KEYS.GROUPS, grouped.map(g => ({
    id:    g.id,
    name:  g.name,
    color: g.color,
    files: files.filter(f => f.group === g.id).map(f => f.name)
  })));
}

function openGroupDashboard(gid) {
  const g = groups.find(g => String(g.id) === String(gid));
  if (!g) return;
  const allGrouped = groups.filter(grp => files.some(f => f.group === grp.id));
  publishGroups(allGrouped);
  Store.set(KEYS.ACTIVE_GROUP, { id: g.id, name: g.name, files: files.filter(f => f.group === g.id).map(f => f.name) });
  window.location.href = 'dashboard.html';
}

function goToDashboard() {
  const grouped = groups.filter(g => files.some(f => f.group === g.id));
  if (!grouped.length) { showToast('Assign files to groups first', 'error'); return; }
  publishGroups(grouped);
  window.location.href = 'dashboard.html';
}

function resetAllData() {
  if (!confirm('This will delete all uploaded files, groups, and dashboards. Are you sure?')) return;
  [KEYS.FILES, KEYS.DRAFT_GROUPS, KEYS.GROUPS, KEYS.DASH_STATE, KEYS.ACTIVE_GROUP, KEYS.PARSED_EVENTS].forEach(k => Store.remove(k));
  Object.keys(memoryEvents).forEach(k => delete memoryEvents[k]);
  files = []; groups = []; selectedIds.clear();
  renderTable(); renderGroups(); updateProcessBtn();
  showToast('All data cleared', 'success');
}

// ── INIT ──
document.addEventListener('DOMContentLoaded', () => {
  loadState();
  initDropzone();
  renderGroups();
  renderTable();
  updateProcessBtn();
});
