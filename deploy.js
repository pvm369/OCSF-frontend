// ============================================================
//  OCSF LOG MAPPER — deploy.js
//  Used by: deploy.html
// ============================================================

// ── STATE ──
const reachedSteps = new Set();
const TOTAL_STEPS  = 4;

// ── PROGRESS BAR ──
function updateProgress() {
  const count = reachedSteps.size;
  const fill  = document.getElementById('progress-fill');
  const label = document.getElementById('progress-pct');
  const pct   = Math.round((count / TOTAL_STEPS) * 100);
  if (fill)  fill.style.width  = pct + '%';
  if (label) label.textContent = count + ' / ' + TOTAL_STEPS;
}

// ── SIDEBAR ACTIVE + SCROLL PROGRESS ──
function initSidebarScroll() {
  const stepMap = {
    'step-prereq':  1,
    'step-install': 2,
    'step-github':  3,
    'step-verify':  4,
  };

  const sideItems = document.querySelectorAll('.sidebar-step[data-step]');
  const blocks    = document.querySelectorAll('.step-block[id]');

  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const stepNum = stepMap[entry.target.id];
      if (!stepNum) return;

      // Highlight active sidebar step
      sideItems.forEach(s => s.classList.remove('active'));
      const active = document.querySelector('.sidebar-step[data-step="' + stepNum + '"]');
      if (active) active.classList.add('active');

      // Steps 1-3 auto-complete on scroll; step 4 needs checklist
      reachedSteps.add(stepNum);
      if (stepNum < 4) {
        const sideStep = document.querySelector('.sidebar-step[data-step="' + stepNum + '"]');
        if (sideStep) sideStep.classList.add('done');
      }

      updateProgress();
    });
  }, { threshold: 0.25 });

  blocks.forEach(b => observer.observe(b));
}

// ── VERIFY CHECKLIST ──
function toggleCheck(el) {
  el.classList.toggle('checked');
  const total   = document.querySelectorAll('.verify-item').length;
  const checked = document.querySelectorAll('.verify-item.checked').length;
  const doneBox = document.getElementById('all-done-box');
  const step4   = document.querySelector('.sidebar-step[data-step="4"]');

  if (checked === total) {
    if (doneBox) doneBox.style.display = 'flex';
    if (step4)   step4.classList.add('done');
  } else {
    if (doneBox) doneBox.style.display = 'none';
    if (step4)   step4.classList.remove('done');
  }
}

// ── COPY CODE BLOCKS ──
function copyCode(btn) {
  const block = btn.closest('.code-block').querySelector('.cb-body');
  const text  = Array.from(block.querySelectorAll('code'))
    .map(c => c.innerText.replace(/^\$\s*/, '').trim())
    .filter(t => t && !t.startsWith('#'))
    .join('\n');

  const flash = () => {
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
  };

  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(flash).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta);
      ta.select(); document.execCommand('copy');
      document.body.removeChild(ta); flash();
    });
  } else {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta);
    ta.select(); document.execCommand('copy');
    document.body.removeChild(ta); flash();
  }
}

// ── INIT ──
document.addEventListener('DOMContentLoaded', () => {
  initSidebarScroll();
  updateProgress();
});
