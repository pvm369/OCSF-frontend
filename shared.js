// ============================================================
//  OCSF LOG MAPPER — Shared Utilities
//  Used by: all pages
// ============================================================

// ── STORAGE KEYS (single source of truth) ──
const KEYS = {
  FILES:         'ocsf_files',         // upload page draft files
  DRAFT_GROUPS:  'ocsf_draft_groups',  // upload page draft groups (not yet published)
  GROUPS:        'ocsf_groups',        // published groups — only written on "Process & Visualize"
  DASH_STATE:    'ocsf_dash_state',
  ACTIVE_GROUP:  'ocsf_active_group',
  PARSED_EVENTS: 'ocsf_parsed_events', // { [filename]: [ocsf events] }
};

// ── STORAGE HELPERS ──
const Store = {
  get(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch(e) {
      console.warn('localStorage write failed:', e);
    }
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch {}
  }
};

// ── TOAST ──
function showToast(msg, type = 'success') {
  let t = document.getElementById('toast');
  if (!t) return;
  document.getElementById('toast-icon').textContent = type === 'success' ? '✓' : '✕';
  document.getElementById('toast-msg').textContent  = msg;
  t.className = `toast show ${type}`;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.className = 'toast'; }, 2600);
}

// ── FORMAT HELPERS ──
function formatSize(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024)        return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function formatDate(d) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function timeAgo(d) {
  const s = Math.floor((Date.now() - new Date(d)) / 1000);
  if (s < 60)    return 'just now';
  if (s < 3600)  return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

function fileIcon(name) {
  if (!name) return '📃';
  if (name.endsWith('.json') || name.endsWith('.jsonl')) return '📄';
  if (name.endsWith('.log'))  return '📋';
  return '📃';
}

function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick(arr)       { return arr[Math.floor(Math.random() * arr.length)]; }

// ── SCROLL REVEAL ──
function initReveal() {
  const io = new IntersectionObserver(entries => {
    entries.forEach((e, i) => {
      if (e.isIntersecting) {
        setTimeout(() => e.target.classList.add('on'), i * 60);
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.08 });
  document.querySelectorAll('.reveal').forEach(el => io.observe(el));
}

document.addEventListener('DOMContentLoaded', initReveal);
