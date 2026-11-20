const KEY = 'leonida-legends-progress-v1';
const FALLBACK_TOTAL = 55;
const ROADMAP_ORDER = ['prologue', 'chapters', 'side-missions', 'activities', 'collectibles', 'heists', 'cleanup', 'platinum'];
const ROADMAP_STAGES = {
  prologue: { title: 'Prologue', blurb: 'The opening beats: learn the ropes in Leonida and bank the first easy trophies.' },
  chapters: { title: 'Main chapters', blurb: 'Play the story in order. Watch for missable moments before moving on.' },
  'side-missions': { title: 'Side missions', blurb: 'Finish the stranger strands and character missions while they are available.' },
  activities: { title: 'Activities & challenges', blurb: 'Races, stunts, shooting ranges, and every optional activity across the state.' },
  collectibles: { title: 'Collectibles', blurb: 'Sweep the map for cards, locations, vehicles, and other hidden finds.' },
  heists: { title: 'Heists & robberies', blurb: 'Plan the big scores, then execute clean getaways without raising the alarm.' },
  cleanup: { title: 'Cleanup', blurb: 'Mop up the remaining odds and ends on the road to 100% completion.' },
  platinum: { title: 'Platinum', blurb: 'The final prize. Earn every other trophy in the list to unlock it.' }
};
const $ = (id) => document.getElementById(id);
const q = (selector) => document.querySelector(selector);
let trophies = [];
let byId = new Map();
let byName = new Map();
let earned = new Set();
let spoiler = false;
let activeKind = 'all';
let searchTerm = '';
let selectedId = null;

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function node(tag, className, textValue) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (textValue !== undefined) el.textContent = textValue;
  return el;
}

function text(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}

function idKey(trophy) {
  return String(trophy?.id ?? trophy?.name ?? '');
}

function titleCase(value) {
  const textValue = String(value ?? '');
  return textValue ? textValue.charAt(0).toUpperCase() + textValue.slice(1) : '';
}

function inferKind(trophy) {
  if (trophy.kind) return String(trophy.kind);
  const haystack = `${trophy.name ?? ''} ${trophy.description ?? ''} ${trophy.guide ?? ''}`.toLowerCase();
  const id = Number(trophy.id);
  if (/online|multiplayer|co-?op/.test(haystack)) return 'online';
  if ((Number.isFinite(id) && id >= 2 && id <= 13) || /\bchapter\b|gone fishing/.test(haystack)) return 'story';
  if (/\b(collect|card set|discover|explore|location|vehicle|waink)\b/.test(haystack)) return 'collectibles';
  if (/\b(race|stunt|activity|challenge|shoot|meditat|fish|arcade|drone|hunt|bowl)/.test(haystack)) return 'activities';
  return 'misc';
}

function inferStage(trophy, kind) {
  if (trophy.stage && ROADMAP_STAGES[trophy.stage]) return trophy.stage;
  const id = Number(trophy.id);
  const haystack = `${trophy.name ?? ''} ${trophy.description ?? ''}`.toLowerCase();
  if (trophy.grade === 'platinum' || id === 1) return 'platinum';
  if (id === 2) return 'prologue';
  if (Number.isFinite(id) && id >= 3 && id <= 13) return 'chapters';
  if (id === 14) return 'cleanup';
  if ((id >= 22 && id <= 27) || id === 29) return 'side-missions';
  if (kind === 'story') return 'chapters';
  if (kind === 'activities' || kind === 'online') return 'activities';
  if (kind === 'collectibles') return 'collectibles';
  if (/\b(rob|heist|vault|armored truck|jewelry|shops|gang)\b/.test(haystack)) return 'heists';
  return 'cleanup';
}

function normalizeTrophy(trophy, index) {
  const kind = inferKind(trophy);
  return {
    ...trophy, id: trophy.id ?? index, kind, missable: trophy.missable === true, stage: inferStage(trophy, kind),
    sources: Array.isArray(trophy.sources) ? trophy.sources : [], steps: Array.isArray(trophy.steps) ? trophy.steps : []
  };
}

function isHiddenBySpoiler(trophy) {
  return Boolean(spoiler && trophy && trophy.kind === 'story' && !earned.has(idKey(trophy)));
}

function loadProgress() {
  let data = {};
  try { data = JSON.parse(localStorage.getItem(KEY) ?? '{}') || {}; } catch { data = {}; }
  return { earned: Array.isArray(data.earned) ? data.earned : [], spoiler: data.spoiler === true };
}

function saveProgress() {
  const ids = [...earned].map((key) => (byId.has(key) ? byId.get(key).id : key));
  localStorage.setItem(KEY, JSON.stringify({ earned: ids, spoiler }));
}

function applyFilters() {
  const query = searchTerm.trim().toLowerCase();
  return trophies.filter((trophy) => {
    if (activeKind === 'missable' && !trophy.missable) return false;
    if (activeKind !== 'all' && activeKind !== 'missable' && trophy.kind !== activeKind) return false;
    if (!query) return true;
    return [trophy.name, trophy.description, trophy.guide].some((value) => String(value ?? '').toLowerCase().includes(query));
  });
}

function gradeBadge(grade) { return node('span', `grade-badge grade-${grade || 'bronze'}`, titleCase(grade || 'bronze')); }
function missablePill() { return node('span', 'missable', 'Missable'); }
function kindChip(kind) { return node('span', 'kind-chip grade-badge', titleCase(kind)); }

function renderTrophyList() {
  const list = $('trophy-list');
  if (!list) return;
  list.replaceChildren();
  const visible = applyFilters();
  text('shown-count', `${visible.length} shown`);
  for (const trophy of visible) {
    const key = idKey(trophy), hidden = isHiddenBySpoiler(trophy);
    const row = node('li', 'trophy-item');
    row.dataset.id = key; row.tabIndex = 0;
    if (earned.has(key)) row.classList.add('earned');
    if (selectedId === key) row.setAttribute('aria-current', 'true');
    const box = node('input', 'trophy-check');
    box.type = 'checkbox'; box.checked = earned.has(key);
    box.setAttribute('aria-label', `Mark ${hidden ? 'Hidden story trophy' : trophy.name} earned`);
    box.addEventListener('click', (event) => event.stopPropagation());
    box.addEventListener('change', () => toggleEarned(trophy, box.checked));
    const content = node('div', 'trophy-content'), heading = node('div', 'trophy-heading');
    heading.append(gradeBadge(trophy.grade), node('span', 'trophy-name', hidden ? 'Hidden story trophy' : trophy.name), kindChip(trophy.kind));
    if (trophy.missable) heading.append(missablePill());
    content.append(heading, node('p', 'trophy-desc', hidden ? 'Locked until earned. Mark this story trophy to reveal its name and description.' : trophy.description));
    row.append(box, content);
    row.addEventListener('click', () => { selectedId = key; renderDetail(trophy); renderTrophyList(); });
    row.addEventListener('keydown', (event) => {
      if (event.target !== row || (event.key !== 'Enter' && event.key !== ' ')) return;
      event.preventDefault(); selectedId = key; renderDetail(trophy); renderTrophyList();
    });
    list.append(row);
  }
}

function toggleEarned(trophy, value) {
  const key = idKey(trophy);
  if (value) earned.add(key); else earned.delete(key);
  saveProgress(); updateProgress(); renderTrophyList(); renderRoadmap();
  if (selectedId === key) renderDetail(trophy);
}

function setupPageExtras() {
  const hint = q('#view-trophies .view-hint');
  if (hint && !$('shown-count')) { const c = node('span'); c.id = 'shown-count'; c.style.display = 'block'; c.setAttribute('aria-live', 'polite'); hint.append(c); }
  const tally = q('.grade-tally');
  if (tally && !$('grade-summary')) { const p = node('p', 'summary-counts'); p.id = 'grade-summary'; tally.after(p); }
  const sidebarSummary = q('.sidebar-summary');
  if (sidebarSummary && !$('progress-summary')) { const p = node('p', 'summary-counts'); p.id = 'progress-summary'; sidebarSummary.append(p); }
  const actions = q('.sidebar-actions');
  if (actions && !$('import-status')) {
    const p = node('p', 'summary-counts'); p.id = 'import-status'; p.setAttribute('role', 'status');
    p.setAttribute('aria-live', 'polite'); p.style.gridColumn = '1 / -1'; actions.append(p);
  }
  const detailHeading = q('#detail-content .detail-heading');
  if (detailHeading && !$('detail-close')) { const b = node('button', 'btn', 'Close'); b.id = 'detail-close'; b.type = 'button'; b.style.marginLeft = 'auto'; detailHeading.append(b); }
  const oldDescription = $('detail-description');
  if (oldDescription && oldDescription.tagName !== 'BLOCKQUOTE') { const quote = node('blockquote', oldDescription.className); quote.id = 'detail-description'; oldDescription.replaceWith(quote); }
  const sourcesSection = $('detail-sources')?.closest('.detail-section');
  if (!$('detail-steps-section')) {
    const section = node('section', 'detail-section'); section.id = 'detail-steps-section'; section.hidden = true;
    const list = node('ol'); list.id = 'detail-steps'; section.append(node('h3', '', 'Steps'), list);
    if (sourcesSection?.parentElement) sourcesSection.before(section); else $('detail-content')?.append(section);
  }
}

function renderDetail(trophy) {
  const empty = $('detail-empty'), content = $('detail-content');
  if (!trophy) { if (empty) empty.hidden = false; if (content) content.hidden = true; return; }
  if (empty) empty.hidden = true; if (content) content.hidden = false;
  const hidden = isHiddenBySpoiler(trophy);
  const grade = $('detail-grade');
  if (grade) { grade.className = `grade-badge grade-${trophy.grade || 'bronze'}`; grade.textContent = titleCase(trophy.grade || 'bronze'); }
  const missable = $('detail-missable');
  if (missable) missable.hidden = !trophy.missable;
  const name = $('detail-name');
  if (name) name.textContent = hidden ? 'Hidden story trophy' : trophy.name;
  const description = $('detail-description');
  if (description) description.textContent = hidden ? 'Locked until earned. Mark this story trophy in the list to reveal its name and description.' : trophy.description;
  const guide = $('detail-guide'), guideSection = guide?.closest('.detail-section');
  if (guideSection) guideSection.hidden = hidden;
  if (guide) {
    guide.replaceChildren();
    if (!hidden) for (const part of String(trophy.guide ?? '').split(/\n\s*\n/).filter((part) => part.trim())) guide.append(node('p', '', part.trim()));
  }
  const stepsSection = $('detail-steps-section'), steps = $('detail-steps');
  const stepList = !hidden && Array.isArray(trophy.steps) ? trophy.steps : [];
  if (stepsSection) stepsSection.hidden = stepList.length === 0;
  if (steps) { steps.replaceChildren(); for (const step of stepList) steps.append(node('li', '', String(step))); }
  const sourcesSection = $('detail-sources')?.closest('.detail-section');
  if (sourcesSection) sourcesSection.hidden = hidden;
  const sources = $('detail-sources');
  if (sources) {
    sources.replaceChildren();
    if (!hidden) for (const source of Array.isArray(trophy.sources) ? trophy.sources : []) {
      const item = node('li'), isObject = source && typeof source === 'object';
      const label = isObject ? (source.label ?? source.url ?? 'Source') : source;
      if (isObject && typeof source.url === 'string' && source.url) {
        const link = node('a', '', String(label)); link.href = source.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; item.append(link);
      } else item.textContent = String(label);
      sources.append(item);
    }
  }
}

function renderRoadmap() {
  const container = $('roadmap-stages');
  if (!container) return;
  container.replaceChildren();
  for (const stageId of ROADMAP_ORDER) {
    const meta = ROADMAP_STAGES[stageId], card = node('section', 'stage-card'), list = node('ul');
    card.dataset.stage = stageId;
    for (const trophy of trophies.filter((item) => item.stage === stageId)) {
      const key = idKey(trophy), hidden = isHiddenBySpoiler(trophy), item = node('li', 'roadmap-row');
      item.dataset.id = key;
      if (earned.has(key)) item.classList.add('earned');
      item.append(gradeBadge(trophy.grade), node('span', 'roadmap-name', hidden ? 'Hidden story trophy' : trophy.name));
      item.append(node('span', 'roadmap-state', earned.has(key) ? 'Earned' : hidden ? 'Locked' : 'Not earned'));
      if (trophy.missable) item.append(missablePill());
      list.append(item);
    }
    card.append(node('h3', '', meta.title), node('p', '', meta.blurb), list);
    container.append(card);
  }
}

function updateProgress() {
  const total = trophies.length || FALLBACK_TOTAL;
  const earnedTrophies = trophies.filter((trophy) => earned.has(idKey(trophy)));
  const count = earnedTrophies.length, percent = total ? Math.round((count / total) * 100) : 0;
  const counts = { platinum: 0, gold: 0, silver: 0, bronze: 0 };
  for (const trophy of earnedTrophies) if (counts[trophy.grade] !== undefined) counts[trophy.grade]++;
  text('progress-text', `${count}/${total} earned`);
  const fill = $('progress-fill');
  if (fill) fill.style.width = `${percent}%`;
  const bar = $('progress-bar');
  if (bar) { bar.setAttribute('aria-valuenow', String(count)); bar.setAttribute('aria-valuemax', String(total)); }
  for (const grade of Object.keys(counts)) text(`count-${grade}`, String(counts[grade]));
  text('grade-summary', `${counts.platinum}P ${counts.gold}G ${counts.silver}S ${counts.bronze}B`);
  text('summary-earned', String(count)); text('summary-remaining', String(Math.max(total - count, 0)));
  text('summary-total', String(total)); text('summary-percent', `${percent}%`);
  const missableTotal = trophies.filter((trophy) => trophy.missable).length;
  const missableEarned = earnedTrophies.filter((trophy) => trophy.missable).length;
  text('progress-summary', `${percent}% complete · ${missableEarned}/${missableTotal} missable earned`);
}

function setImportStatus(message) { text('import-status', message); }

function exportProgress() {
  const names = trophies.filter((trophy) => earned.has(idKey(trophy))).map((trophy) => trophy.name);
  const payload = { version: 1, game: 'GTA 6', exportedAt: new Date().toISOString(), earned: names };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const link = node('a'); link.href = url; link.download = 'leonida-legends-progress.json';
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function importProgress(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(String(reader.result ?? ''));
      const values = Array.isArray(data) ? data : data && Array.isArray(data.earned) ? data.earned : null;
      if (!values) throw new Error('The file has no earned list.');
      let added = 0;
      for (const value of values) {
        let trophy = byId.get(String(value));
        if (!trophy && typeof value === 'string') trophy = byName.get(value.trim().toLowerCase());
        if (!trophy) continue;
        const key = idKey(trophy);
        if (!earned.has(key)) { earned.add(key); added++; }
      }
      if (data && typeof data === 'object' && typeof data.spoiler === 'boolean') {
        spoiler = data.spoiler;
        const toggle = $('spoiler-toggle'); if (toggle) toggle.checked = spoiler;
      }
      saveProgress(); renderAll(); setImportStatus(`Imported ${added} new ${added === 1 ? 'trophy' : 'trophies'}.`);
    } catch (error) { setImportStatus(`Import failed: ${error.message}`); }
  };
  reader.onerror = () => setImportStatus('Import failed: the file could not be read.');
  reader.readAsText(file);
}

function showView(view) {
  const isRoadmap = view === 'roadmap';
  const trophiesView = $('view-trophies'), roadmapView = $('view-roadmap');
  if (trophiesView) trophiesView.hidden = isRoadmap;
  if (roadmapView) roadmapView.hidden = !isRoadmap;
  const trophiesTab = $('tab-trophies'), roadmapTab = $('tab-roadmap');
  if (trophiesTab) trophiesTab.setAttribute('aria-selected', String(!isRoadmap));
  if (roadmapTab) roadmapTab.setAttribute('aria-selected', String(isRoadmap));
  if (isRoadmap) renderRoadmap();
}

function renderAll() {
  renderTrophyList(); renderRoadmap(); updateProgress();
  renderDetail(selectedId ? byId.get(selectedId) : null);
}

function setupEvents() {
  document.querySelectorAll('.filter-btn').forEach((button) => {
    button.addEventListener('click', () => {
      activeKind = button.dataset.kind || 'all';
      document.querySelectorAll('.filter-btn').forEach((other) => other.setAttribute('aria-pressed', String(other === button)));
      renderTrophyList();
    });
  });
  const search = $('search');
  if (search) search.addEventListener('input', () => { searchTerm = search.value; renderTrophyList(); });
  const spoilerToggle = $('spoiler-toggle');
  if (spoilerToggle) spoilerToggle.addEventListener('change', () => {
    spoiler = spoilerToggle.checked; saveProgress(); renderTrophyList(); renderRoadmap();
    if (selectedId) renderDetail(byId.get(selectedId));
  });
  $('export-btn')?.addEventListener('click', exportProgress);
  $('import-btn')?.addEventListener('click', () => $('import-file')?.click());
  $('import-file')?.addEventListener('change', (event) => { importProgress(event.target.files?.[0]); event.target.value = ''; });
  $('reset-btn')?.addEventListener('click', () => {
    if (!confirm('Reset all trophy progress? This cannot be undone.')) return;
    earned.clear(); selectedId = null; saveProgress(); renderAll(); setImportStatus('Progress reset.');
  });
  $('detail-close')?.addEventListener('click', () => { selectedId = null; renderDetail(null); renderTrophyList(); });
  document.querySelectorAll('.tab-btn').forEach((button) => button.addEventListener('click', () => showView(button.dataset.view)));
}

async function init() {
  setupPageExtras();
  const stored = loadProgress();
  earned = new Set(stored.earned.map(String));
  spoiler = stored.spoiler;
  const spoilerToggle = $('spoiler-toggle');
  if (spoilerToggle) spoilerToggle.checked = spoiler;
  try {
    const response = await fetch('data/trophies.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const list = Array.isArray(data) ? data : data && Array.isArray(data.trophies) ? data.trophies : [];
    trophies = list.map(normalizeTrophy);
    byId = new Map(); byName = new Map();
    for (const trophy of trophies) {
      byId.set(idKey(trophy), trophy);
      if (trophy.name) byName.set(String(trophy.name).trim().toLowerCase(), trophy);
    }
  } catch (error) {
    const list = $('trophy-list');
    if (list) list.innerHTML = `<li class="detail-empty">Could not load trophies: ${esc(error.message)}</li>`;
  }
  setupEvents(); renderAll();
}

if (typeof window !== 'undefined') Object.assign(window, {
  renderTrophyList, applyFilters, renderDetail, renderRoadmap, isHiddenBySpoiler,
  loadProgress, saveProgress, exportProgress, importProgress, updateProgress
});
if (typeof document !== 'undefined') init();
export { renderTrophyList, applyFilters, renderDetail, renderRoadmap, isHiddenBySpoiler, loadProgress, saveProgress, exportProgress, importProgress, updateProgress };
