/* 우리반 자리 바꾸기 — 순수 JS, 서버 불필요 (GitHub Pages용) */
'use strict';

/* ================= 상태 / 저장 ================= */
const KEY = 'seat-changer-v1';
const MAX_DIM = 15;
const SLOT_N = 5;
// 떼기 반경: 2칸 이상의 자연수만 사용 (1칸은 제한이 없는 것과 같음)
const normSep = v => Math.min(40, Math.max(2, Math.ceil(Number(v) || 2)));
const GC = ['#f59ea0', '#f5c26b', '#a9d96b', '#6bd4b0', '#6bb8f5', '#9b8cf5', '#e08cf5', '#f58cb8'];
const gcolor = g => GC[(g - 1) % GC.length];

const defaultState = () => ({
  version: 2,
  className: '',
  students: [],            // {id, no(자동 연번), name, gender:'M'|'F'|''}
  nextId: 1,
  layout: { rows: 5, cols: 6, disabled: [], groups: {} },   // 행·열은 0부터, 0행 = 맨 앞줄. groups: {"r,c": 모둠번호}
  pairs: [],               // {a,b}
  seps: [],                // {a,b,d}
  fixed: [],               // {s,r,c}
  ranges: [],              // {s,r1,r2,c1,c2}
  pairHistory: [],         // ["작은id-큰id"] 이전에 짝(또는 같은 모둠)이었던 쌍
  settings: { mode: 'seat', pairMode: 'side', mix: false, avoidPrev: true, avoidPast: true, animation: true },
  slots: Array(SLOT_N).fill(null),   // {seats:{id:[r,c]}, warnings:[], at, mode}
  final: null,
  activeSlot: 0,
  showAll: false,
  view: 'student',
});

function renumber(st) { st.students.forEach((s, i) => (s.no = i + 1)); }

function migrate(o) {
  const d = defaultState();
  const s = Object.assign(d, o || {});
  s.settings = Object.assign(defaultState().settings, (o && o.settings) || {});
  s.layout = Object.assign(defaultState().layout, (o && o.layout) || {});
  if (!s.layout.groups) s.layout.groups = {};
  if (!Array.isArray(s.pairHistory)) s.pairHistory = [];
  delete s.settings.sepDist;   // 예전 '떼기 기본 반경' 옵션은 제거됨
  s.seps = (s.seps || []).map(p => ({ ...p, d: normSep(p.d) }));
  s.pairs = (s.pairs || []).map(p => ({ ...p, mode: p.mode || s.settings.pairMode }));
  if (!Array.isArray(s.slots) || s.slots.length !== SLOT_N) s.slots = Array(SLOT_N).fill(null);
  renumber(s);
  return s;
}

let state = (() => {
  try { const raw = localStorage.getItem(KEY); if (raw) return migrate(JSON.parse(raw)); } catch (e) { /* ignore */ }
  return defaultState();
})();

let savedTimer;
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { notify('브라우저 저장에 실패했어요.\n"저장 파일 받기"로 따로 보관해 주세요.'); return; }
  const b = $('#savedBadge'); b.classList.add('on');
  clearTimeout(savedTimer); savedTimer = setTimeout(() => b.classList.remove('on'), 1200);
}

/* ================= 유틸 ================= */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const byId = id => state.students.find(s => s.id === id);
const label = s => s ? (s.name || `${s.no}번`) : '(삭제됨)';
const fullLabel = s => s ? `${s.no}번 ${s.name || ''}`.trim() : '(삭제됨)';
const isOff = (r, c) => state.layout.disabled.includes(r + ',' + c);
const seatCount = () => state.layout.rows * state.layout.cols - state.layout.disabled.length;
const groupOf = (r, c) => state.layout.groups[r + ',' + c];
// 범위 제한: 사각형({r1,r2,c1,c2}) 또는 자유 지정({cells:["r,c",...]})
const rangeHas = (g, r, c) => (g.cells ? g.cells.includes(r + ',' + c) : r >= g.r1 && r <= g.r2 && c >= g.c1 && c <= g.c2);
const mixAvailable = () => !state.students.some(s => !s.gender);
function enforceMix() {   // 성별 미지정 학생이 있으면 '남녀 섞기'를 자동 해제
  if (state.settings.mix && !mixAvailable()) { state.settings.mix = false; save(); return true; }
  return false;
}
const pairKey = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);
let busy = false;
let editMode = 'seat';

/* ---- 통로(전부 빈 줄/열)를 뺀 줄·열 번호 ---- */
function dimsOf(L) {
  const aisleRows = [...Array(L.rows).keys()].map(r => [...Array(L.cols).keys()].every(c => L.disabled.includes(r + ',' + c)));
  const aisleCols = [...Array(L.cols).keys()].map(c => [...Array(L.rows).keys()].every(r => L.disabled.includes(r + ',' + c)));
  const rowNo = [], colNo = [], realRows = [], realCols = [];
  aisleRows.forEach((a, r) => { if (a) rowNo.push(null); else { realRows.push(r); rowNo.push(realRows.length); } });
  aisleCols.forEach((a, c) => { if (a) colNo.push(null); else { realCols.push(c); colNo.push(realCols.length); } });
  return { aisleRows, aisleCols, rowNo, colNo, realRows, realCols };
}
const dims = () => dimsOf(state.layout);
const upTo = (arr, i) => arr.filter(v => v <= i).length;
const before = (arr, i) => arr.filter(v => v < i).length;
function seatText(r, c) { const D = dims(); return `${upTo(D.realRows, r)}행 ${upTo(D.realCols, c)}열`; }
function rangeText(g) {
  if (g.cells) return `자유 지정 ${g.cells.length}칸`;
  const D = dims();
  return `${before(D.realRows, g.r1) + 1}~${upTo(D.realRows, g.r2)}행, ${before(D.realCols, g.c1) + 1}~${upTo(D.realCols, g.c2)}열`;
}

/* ---- 토스트(가벼운 성공 안내) / 모달(오류·확인) ---- */
let toastTimer;
function toast(msg, ms = 2800) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), ms);
}
let modalQueue = Promise.resolve();
function modal(title, msg, buttons) {
  const run = () => new Promise(res => {
    const d = $('#modal');
    $('#modalTitle').textContent = title; $('#modalMsg').textContent = msg;
    const box = $('#modalBtns'); box.innerHTML = '';
    const done = v => { d.oncancel = null; d.close(); res(v); };
    buttons.forEach(b => {
      const el = document.createElement('button');
      el.className = 'btn ' + (b.cls || ''); el.textContent = b.t; el.onclick = () => done(b.v);
      box.appendChild(el);
    });
    d.oncancel = e => { e.preventDefault(); done((buttons.find(b => b.esc) || {}).v ?? false); };
    d.showModal();
    box.lastElementChild?.focus();
  });
  const p = modalQueue.then(run);
  modalQueue = p.catch(() => { });
  return p;
}
const ask = (msg, { title = '확인해 주세요', ok = '확인', danger = false } = {}) =>
  modal(title, msg, [{ t: '취소', v: false, esc: true }, { t: ok, v: true, cls: danger ? 'danger-fill' : 'primary' }]);
const notify = (msg, title = '알려드려요') => modal(title, msg, [{ t: '확인', v: true, cls: 'primary', esc: true }]);

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const today = () => new Date().toISOString().slice(0, 10);
const fileBase = () => (state.className.trim() || '우리반').replace(/[\\/:*?"<>|]/g, '_');

/* 좌석·명단을 바꾸면 임시 저장 / 확정 자리는 무효가 되므로 확인 */
async function guard() {
  const has = state.slots.some(Boolean) || state.final;
  if (!has) return true;
  if (!await ask('명단이나 좌석 배열을 바꾸면 임시 저장된 자리와 확정된 자리가 초기화돼요.\n계속할까요?', { ok: '계속', danger: true })) return false;
  state.slots = Array(SLOT_N).fill(null); state.final = null;
  return true;
}

/* ================= ① 기초 설정 렌더 ================= */
function renderSetup() { renderStudents(); renderLayout(); renderOptions(); renderConstraints(); }

function genderCount() {
  const st = state.students;
  return `${st.length}명 (남 ${st.filter(s => s.gender === 'M').length} · 여 ${st.filter(s => s.gender === 'F').length})`;
}
function renderStudents() {
  const st = state.students;
  $('#studentCount').textContent = genderCount();
  $('#studentTable').innerHTML =
    '<tr><th>번호</th><th>이름</th><th>성별</th><th></th></tr>' +
    (st.length ? st.map((s, i) => `<tr>
      <td class="no">${s.no}</td>
      <td><input type="text" data-i="${i}" data-f="name" value="${esc(s.name)}" maxlength="20"></td>
      <td><select data-i="${i}" data-f="gender">
        <option value="" ${s.gender === '' ? 'selected' : ''}>-</option>
        <option value="M" ${s.gender === 'M' ? 'selected' : ''}>남</option>
        <option value="F" ${s.gender === 'F' ? 'selected' : ''}>여</option></select></td>
      <td><button class="x" data-del-student="${i}" title="삭제">✕</button></td></tr>`).join('')
      : '<tr><td colspan="4" style="padding:14px;color:var(--muted)">학생이 없습니다. 추가하거나 엑셀로 올려 주세요.</td></tr>');
}

function renderLayout() {
  const { rows, cols, groups } = state.layout, D = dims();
  $('#layRows').value = rows; $('#layCols').value = cols;
  $('#seatSummary').textContent = `좌석 ${seatCount()}개`;
  $$('#editSeg button').forEach(b => b.classList.toggle('on', b.dataset.edit === editMode));
  $('#groupTools').hidden = editMode !== 'group';
  const grpMode = editMode === 'group';
  let h = `<div class="le" style="grid-template-columns:repeat(${cols + 1},auto)"><div class="podium podium-bar" style="grid-column:1/-1;text-align:center">교 탁 (칠판)</div><span></span>`;
  for (let c = 0; c < cols; c++) {
    h += D.aisleCols[c] ? `<button class="hd aisle ${grpMode ? 'static' : ''}" ${grpMode ? '' : `data-lay-col="${c}"`}>통로</button>`
      : `<button class="hd ${grpMode ? 'static' : ''}" ${grpMode ? '' : `data-lay-col="${c}"`}>${D.colNo[c]}열</button>`;
  }
  for (let r = 0; r < rows; r++) {
    h += D.aisleRows[r] ? `<button class="hd aisle ${grpMode ? 'static' : ''}" ${grpMode ? '' : `data-lay-row="${r}"`}>통로</button>`
      : `<button class="hd ${grpMode ? 'static' : ''}" ${grpMode ? '' : `data-lay-row="${r}"`}>${D.rowNo[r]}행</button>`;
    for (let c = 0; c < cols; c++) {
      const off = isOff(r, c), g = groups[r + ',' + c];
      const style = !off && g ? `style="--gc:${gcolor(g)}55;--gc-b:${gcolor(g)}"` : '';
      h += `<button class="cell ${off ? 'off' : 'on'}" data-lay="${r},${c}" ${style}>${off ? '✕' : (g || '')}</button>`;
    }
  }
  $('#layoutEditor').innerHTML = h + '</div>';
}

// 떼기 반경의 최댓값 = 좌석 배열에서 가장 먼 두 자리 사이의 거리(줄 차이·열 차이 중 큰 값). 최소 2
function maxSepDist() {
  const pts = [];
  for (let r = 0; r < state.layout.rows; r++) for (let c = 0; c < state.layout.cols; c++) if (!isOff(r, c)) pts.push([r, c]);
  let m = 0;
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) m = Math.max(m, Math.max(Math.abs(pts[i][0] - pts[j][0]), Math.abs(pts[i][1] - pts[j][1])));
  return Math.max(2, Math.floor(m + 1e-9));
}
// 선택지를 2~최댓값으로 맞추고, 최댓값을 넘는 기존 값은 최댓값으로 줄인다
function refreshSepSelects() {
  const max = maxSepDist(), clamp = v => Math.min(max, normSep(v));
  const opts = Array.from({ length: max - 1 }, (_, i) => `<option value="${i + 2}">${i + 2}</option>`).join('');
  const B = $('#sepD'), curB = B.value || 2;
  let changed = false;
  state.seps.forEach(p => { if (p.d !== clamp(p.d)) { p.d = clamp(p.d); changed = true; } });
  B.innerHTML = opts; B.value = clamp(curB);
  if (changed) save();
}
function renderOptions() {
  enforceMix();
  const s = state.settings;
  refreshSepSelects();
  $('#optMode').value = s.mode; $('#optPairMode').value = s.pairMode;
  $('#optMix').checked = s.mix; $('#optAvoid').checked = s.avoidPrev; $('#optPast').checked = s.avoidPast; $('#optAnim').checked = s.animation;
  $('#className').value = state.className;
  $('#pastCount').textContent = `기록된 짝 ${state.pairHistory.length}쌍`;
  $('#optPairMode').disabled = s.mode === 'group';
  $('#modeHint').textContent = s.mode === 'group'
    ? '모둠 배치: 좌석 배열의 "모둠 편집 모드"로 만든 모둠 단위로 학생을 나눕니다. 붙이기 = 같은 모둠, 떼기 = 다른 모둠, 이전 짝 = 같은 모둠이었던 학생.'
    : '일반 자리: 학생을 한 명씩 자리에 배치합니다. 이전 짝 = 바로 옆자리(사이에 통로가 없는 경우)였던 학생.';
}

const pend = { fixed: null, range: null };
function studentOptions(sel, exclude) {
  const list = state.students.filter(s => s.id !== exclude);
  if (!list.length) return '<option value="">(학생 없음)</option>';
  return list.map(s => `<option value="${s.id}" ${String(s.id) === String(sel) ? 'selected' : ''}>${esc(fullLabel(s))}</option>`).join('');
}
// 왼쪽에서 고른 학생은 오른쪽 목록에서 제외
function fillPairSelects(p) {
  const a = $('#' + p + 'A'), b = $('#' + p + 'B');
  a.innerHTML = studentOptions(a.dataset.sel ?? a.value);
  b.innerHTML = studentOptions(b.dataset.sel ?? b.value, +a.value || undefined);
  delete a.dataset.sel; delete b.dataset.sel;
}

function miniMap(rg) {
  const { rows, cols } = state.layout;
  let h = `<span class="mini-map" style="grid-template-columns:repeat(${cols},1fr);grid-template-rows:repeat(${rows},1fr);aspect-ratio:${cols}/${rows}">`;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const on = rangeHas(rg, r, c);
    h += `<i class="${isOff(r, c) ? 'off' : on ? 'on' : ''}"></i>`;
  }
  return h + '</span>';
}

// 학생 선택 드롭다운 공통 너비: 가장 긴 항목 글씨 너비 + 좌우 여백·테두리·화살표
function updateStudentSelectWidth() {
  const ref = $('#pairA'), cs = getComputedStyle(ref), ctx = document.createElement('canvas').getContext('2d');
  ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const widest = Math.max(0, ...state.students.map(s => ctx.measureText(fullLabel(s)).width));
  const px = Math.ceil(widest + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + 4 + 22);
  document.documentElement.style.setProperty('--stu-w', Math.max(px, 96) + 'px');
}
function renderConstraints() {
  refreshSepSelects(); updateStudentSelectWidth();
  fillPairSelects('pair'); fillPairSelects('sep');
  for (const id of ['fixS', 'rngS']) $('#' + id).innerHTML = studentOptions($('#' + id).value);

  const empty = t => `<li class="empty">${t}</li>`;
  $('#pairList').innerHTML = state.pairs.length ? state.pairs.map((p, i) =>
    `<li><span class="grow">${esc(label(byId(p.a)))} ↔ ${esc(label(byId(p.b)))}${state.settings.mode === 'group' ? '' : ' · ' + PAIR_LABEL[p.mode || state.settings.pairMode]}</span><button class="x" data-del="pairs:${i}">✕</button></li>`).join('') : empty('지정된 학생 없음');
  $('#sepList').innerHTML = state.seps.length ? state.seps.map((p, i) =>
    `<li><span class="grow">${esc(label(byId(p.a)))} ↔ ${esc(label(byId(p.b)))} · 반경 ${p.d}칸 이상</span><button class="x" data-del="seps:${i}">✕</button></li>`).join('') : empty('지정된 학생 없음');
  $('#fixedList').innerHTML = state.fixed.length ? state.fixed.map((f, i) =>
    `<li><span class="grow">${esc(label(byId(f.s)))} → ${seatText(f.r, f.c)}</span><button class="x" data-del="fixed:${i}">✕</button></li>`).join('') : empty('지정된 학생 없음');
  $('#rangeList').innerHTML = state.ranges.length ? state.ranges.map((g, i) =>
    `<li>${miniMap(g)}<span class="grow">${esc(label(byId(g.s)))} : ${rangeText(g)}</span><button class="x" data-del="ranges:${i}">✕</button></li>`).join('') : empty('지정된 학생 없음');
  $('#fixPicked').textContent = pend.fixed ? seatText(pend.fixed.r, pend.fixed.c) : '선택 안 됨';
  $('#rngPicked').textContent = pend.range ? rangeText(pend.range) : '선택 안 됨';
}

/* ---- 명단 편집 ---- */
function addStudent(name = '', gender = '') {
  state.students.push({ id: state.nextId++, no: 0, name, gender });
  renumber(state);
}
async function removeStudent(i) {
  const s = state.students[i]; if (!s) return;
  if (!await guard()) return;
  state.students.splice(i, 1); renumber(state);
  state.pairs = state.pairs.filter(p => p.a !== s.id && p.b !== s.id);
  state.seps = state.seps.filter(p => p.a !== s.id && p.b !== s.id);
  state.fixed = state.fixed.filter(p => p.s !== s.id);
  state.ranges = state.ranges.filter(p => p.s !== s.id);
  state.pairHistory = state.pairHistory.filter(k => !k.split('-').map(Number).includes(s.id));
  save(); renderStudents(); renderConstraints(); renderOptions();
}
function parseGender(v) {
  const t = String(v ?? '').trim().toLowerCase();
  if (['남', '남자', 'm', 'male', '남학생'].includes(t)) return 'M';
  if (['여', '여자', 'f', 'female', '여학생'].includes(t)) return 'F';
  return '';
}

/* ================= 좌석 선택 창 ================= */
// mode 'cell'  : 한 칸 선택(고정석)
// mode 'range' : 여러 칸 선택(범위 제한) — 사각형 지정 / 칸 하나씩·드래그 / 프리셋을 자유롭게 섞어 쓸 수 있음
const pk = { mode: 'cell', sel: null, set: new Set(), tool: 'rect', anchor: null, cb: null, base: '', painting: false, paint: true };

function rectKeys(r1, c1, r2, c2) {
  const out = [];
  for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) if (!isOff(r, c)) out.push(r + ',' + c);
  return out;
}
const addRect = (r1, c1, r2, c2) => rectKeys(r1, c1, r2, c2).forEach(k => pk.set.add(k));
function setFromEntry(g) {
  const out = new Set();
  if (!g) return out;
  if (g.cells) g.cells.forEach(k => out.add(k)); else rectKeys(g.r1, g.c1, g.r2, g.c2).forEach(k => out.add(k));
  return out;
}
// 선택한 칸이 빈틈없는 사각형이면 사각형으로, 아니면 칸 목록으로 저장
function normalizeSel(set) {
  if (!set.size) return null;
  const pts = [...set].map(k => k.split(',').map(Number));
  const r1 = Math.min(...pts.map(p => p[0])), r2 = Math.max(...pts.map(p => p[0]));
  const c1 = Math.min(...pts.map(p => p[1])), c2 = Math.max(...pts.map(p => p[1]));
  const full = rectKeys(r1, c1, r2, c2);
  if (full.length === set.size && full.every(k => set.has(k))) return { r1, r2, c1, c2 };
  return { cells: [...set] };
}

function openPicker({ title, hint, mode, initial, cb }) {
  pk.mode = mode; pk.cb = cb; pk.anchor = null; pk.base = hint; pk.tool = 'rect'; pk.painting = false;
  pk.sel = mode === 'cell' && initial ? { ...initial } : null;
  pk.set = mode === 'range' ? setFromEntry(initial) : new Set();
  $('#pickerTitle').textContent = title;
  const D = dims(), RR = D.realRows, RC = D.realCols, q = $('#pickerQuick');
  q.innerHTML = '';
  if (mode === 'range') {
    const tools = document.createElement('div'); tools.className = 'seg left'; tools.id = 'pickerTools';
    [['rect', '사각형으로 선택'], ['cell', '칸 하나씩 · 드래그']].forEach(([k, t]) => {
      const b = document.createElement('button'); b.textContent = t; b.dataset.tool = k;
      b.onclick = () => { pk.tool = k; pk.anchor = null; drawPicker(); };
      tools.appendChild(b);
    });
    q.appendChild(tools);
    const nr = RR.length, nc = RC.length, lastR = RR[nr - 1], lastC = RC[nc - 1];
    const defs = [['전체', RR[0], lastR, RC[0], lastC]];
    for (const n of [1, 2, 3]) if (n < nr) defs.push([`앞 ${n}줄`, RR[0], RR[n - 1], RC[0], lastC]);
    for (const n of [1, 2]) if (n < nr) defs.push([`뒤 ${n}줄`, RR[nr - n], lastR, RC[0], lastC]);
    if (nc > 1) { const h = Math.ceil(nc / 2); defs.push(['왼쪽 절반', RR[0], lastR, RC[0], RC[h - 1]], ['오른쪽 절반', RR[0], lastR, RC[nc - h], lastC]); }
    defs.forEach(([t, r1, r2, c1, c2]) => {
      const b = document.createElement('button'); b.className = 'btn small'; b.textContent = '+ ' + t;
      b.onclick = () => { addRect(r1, c1, r2, c2); pk.anchor = null; drawPicker(); };
      q.appendChild(b);
    });
    const clr = document.createElement('button'); clr.className = 'btn small danger'; clr.textContent = '선택 모두 지우기';
    clr.onclick = () => { pk.set.clear(); pk.anchor = null; drawPicker(); };
    q.appendChild(clr);
  }
  drawPicker(); $('#picker').showModal();
}
function drawPicker() {
  const { rows, cols } = state.layout, D = dims(), range = pk.mode === 'range';
  const grid = $('#pickerGrid');
  grid.style.gridTemplateColumns = `repeat(${cols},auto)`;
  grid.classList.toggle('paint', range && pk.tool === 'cell');
  $$('#pickerTools button').forEach(b => b.classList.toggle('on', b.dataset.tool === pk.tool));
  let h = '';
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const sel = range ? pk.set.has(r + ',' + c) : (pk.sel && pk.sel.r === r && pk.sel.c === c);
    const pre = pk.anchor && pk.anchor.r === r && pk.anchor.c === c;
    h += `<button class="pk ${isOff(r, c) ? 'offc' : ''} ${sel ? 'sel' : ''} ${pre ? 'pre' : ''}" data-r="${r}" data-c="${c}">${D.rowNo[r] ?? ''}-${D.colNo[c] ?? ''}</button>`;
  }
  grid.innerHTML = h;
  $('#pickerHint').textContent = range ? `${pk.base} (선택된 칸: ${pk.set.size}개)` : pk.base;
}
// 칸 하나씩·드래그 칠하기 (마우스·터치 공통)
function paintCell(btn) {
  if (!btn || btn.classList.contains('offc')) return;
  const k = btn.dataset.r + ',' + btn.dataset.c;
  if (pk.paint) pk.set.add(k); else pk.set.delete(k);
  btn.classList.toggle('sel', pk.paint);
  $('#pickerHint').textContent = `${pk.base} (선택된 칸: ${pk.set.size}개)`;
}
{
  const g = $('#pickerGrid');
  g.addEventListener('pointerdown', e => {
    if (!(pk.mode === 'range' && pk.tool === 'cell')) return;
    const b = e.target.closest('.pk'); if (!b || b.classList.contains('offc')) return;
    e.preventDefault();
    pk.painting = true; pk.paint = !pk.set.has(b.dataset.r + ',' + b.dataset.c);
    paintCell(b);
  });
  g.addEventListener('pointermove', e => {
    if (!pk.painting) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    paintCell(el && el.closest ? el.closest('.pk') : null);
  });
  document.addEventListener('pointerup', () => { pk.painting = false; });
  document.addEventListener('pointercancel', () => { pk.painting = false; });
}

/* ================= 검증 / 배치 알고리즘 ================= */
function validate() {
  const e = [], n = state.students.length, seats = seatCount();
  if (n === 0) e.push('학생 명단이 비어 있어요.');
  if (n > seats) e.push(`학생(${n}명)이 좌석(${seats}개)보다 많아요. 좌석 배열을 늘려 주세요.`);
  if (state.settings.mode === 'group' && !Object.keys(state.layout.groups).some(k => { const [r, c] = k.split(',').map(Number); return !isOff(r, c); }))
    e.push('모둠 배치인데 만들어진 모둠이 없어요. 좌석 배열의 "모둠 편집 모드"에서 모둠을 만들어 주세요.');
  const taken = {};
  for (const f of state.fixed) {
    const s = byId(f.s); if (!s) continue;
    if (f.r >= state.layout.rows || f.c >= state.layout.cols || isOff(f.r, f.c)) e.push(`${label(s)}의 고정석(${seatText(f.r, f.c)})이 좌석이 아니에요.`);
    const k = f.r + ',' + f.c;
    if (taken[k]) e.push(`${label(s)}와(과) ${label(taken[k])}의 고정석이 같아요.`); else taken[k] = s;
  }
  const rs = {};
  for (const g of state.ranges) {
    let ok = false;
    for (let r = 0; r < state.layout.rows; r++) for (let c = 0; c < state.layout.cols; c++) if (!isOff(r, c) && rangeHas(g, r, c)) ok = true;
    (rs[g.s] ??= []).push(ok);
  }
  for (const [id, arr] of Object.entries(rs)) if (!arr.some(Boolean)) e.push(`${label(byId(+id))}의 범위 안에 좌석이 없어요.`);
  for (const p of state.pairs) if (state.seps.some(q => (q.a === p.a && q.b === p.b) || (q.a === p.b && q.b === p.a)))
    e.push(`${label(byId(p.a))}·${label(byId(p.b))}이(가) 붙이기와 떼기에 모두 들어 있어요.`);
  return e;
}

function solve() {
  const S = state.students, n = S.length, gm = state.settings.mode === 'group';
  const seats = [], seatIdx = {};
  for (let r = 0; r < state.layout.rows; r++) for (let c = 0; c < state.layout.cols; c++)
    if (!isOff(r, c)) { seatIdx[r + ',' + c] = seats.length; seats.push({ r, c }); }
  const sid = {}; S.forEach((s, i) => (sid[s.id] = i));
  // 거리 = 중심이 같은 정사각형 기준: 줄 차이와 열 차이 중 큰 값 (대각선도 피타고라스가 아닌 이 값)
  const dist = (a, b) => Math.max(Math.abs(a.r - b.r), Math.abs(a.c - b.c));
  const gOf = seats.map((st, k) => (gm ? (groupOf(st.r, st.c) ?? 's' + k) : null));
  const lr = seats.map(st => [seatIdx[st.r + ',' + (st.c - 1)], seatIdx[st.r + ',' + (st.c + 1)]].filter(v => v != null));
  // "옆 사람" 관계: 일반=좌우 이웃(통로로 끊기면 이웃 아님), 모둠=같은 모둠 구성원
  const nbrs = seats.map((_, k) => (gm ? seats.map((_, j) => j).filter(j => j !== k && gOf[j] === gOf[k]) : lr[k]));
  const pairOK = (ka, kb, pm) => {
    if (gm) return gOf[ka] === gOf[kb];
    const a = seats[ka], b = seats[kb], dr = Math.abs(a.r - b.r), dc = Math.abs(a.c - b.c);
    return (pm || state.settings.pairMode) === 'side' ? (dr === 0 && dc === 1) : (Math.max(dr, dc) === 1);
  };
  const sepOK = (ka, kb, d) => (gm ? gOf[ka] !== gOf[kb] : dist(seats[ka], seats[kb]) + 1e-9 >= d);

  const pairN = S.map(() => []), sepN = S.map(() => []), pairs = [], seps = [];
  for (const p of state.pairs) { const a = sid[p.a], b = sid[p.b]; if (a == null || b == null || a === b) continue; const pm = p.mode || state.settings.pairMode; pairs.push([a, b, pm]); pairN[a].push([b, pm]); pairN[b].push([a, pm]); }
  for (const p of state.seps) { const a = sid[p.a], b = sid[p.b]; if (a == null || b == null || a === b) continue; seps.push([a, b, p.d]); sepN[a].push([b, p.d]); sepN[b].push([a, p.d]); }

  const hist = S.map(() => new Set());
  if (state.settings.avoidPast) for (const k of state.pairHistory) {
    const [x, y] = k.split('-').map(Number), a = sid[x], b = sid[y];
    if (a != null && b != null) { hist[a].add(b); hist[b].add(a); }
  }
  const hasHist = hist.some(h => h.size);

  const domain = S.map(s => {
    const fx = state.fixed.find(f => f.s === s.id);
    if (fx) { const k = seatIdx[fx.r + ',' + fx.c]; return k == null ? [] : [k]; }
    const rg = state.ranges.filter(g => g.s === s.id);
    if (!rg.length) return seats.map((_, k) => k);
    const out = [];
    seats.forEach((st, k) => { if (rg.some(g => rangeHas(g, st.r, st.c))) out.push(k); });
    return out;
  });
  const isFixed = S.map(s => state.fixed.some(f => f.s === s.id));
  const prev = S.map(s => { const p = state.final && state.final.seats[s.id]; return p ? seatIdx[p[0] + ',' + p[1]] : -1; });
  const avoidPrev = state.settings.avoidPrev, mix = state.settings.mix && mixAvailable();

  let assign, occ, nodes, limit, strict = false;
  const cand = (i, useC) => {
    const out = [];
    for (const s of domain[i]) {
      if (occ[s] >= 0) continue;
      let ok = true;
      if (useC) {
        for (const [j, pm] of pairN[i]) if (assign[j] >= 0 && !pairOK(s, assign[j], pm)) { ok = false; break; }
        if (ok) for (const [j, d] of sepN[i]) if (assign[j] >= 0 && !sepOK(s, assign[j], d)) { ok = false; break; }
        if (ok && strict) for (const nb of nbrs[s]) { const j = occ[nb]; if (j >= 0 && hist[i].has(j)) { ok = false; break; } }
      }
      if (ok) out.push(s);
    }
    return out;
  };
  const score = (i, s) => {
    let sc = Math.random();
    if (gm) {
      let cnt = 0;
      for (const nb of nbrs[s]) { const j = occ[nb]; if (j >= 0) { cnt++; if (mix && S[i].gender && S[j].gender) sc += S[j].gender !== S[i].gender ? 0.9 : -0.9; } }
      sc -= 0.4 * cnt;   // 모둠 인원이 고르게 차도록
    } else if (mix && S[i].gender) {
      for (const nb of lr[s]) { const j = occ[nb]; if (j >= 0 && S[j].gender) sc += S[j].gender !== S[i].gender ? 0.7 : -0.3; }
    }
    if (hasHist) for (const nb of nbrs[s]) { const j = occ[nb]; if (j >= 0 && hist[i].has(j)) sc -= 5; }
    if (avoidPrev && prev[i] === s) sc -= 5;
    return sc;
  };
  const rec = (count, useC) => {
    if (count === n) return true;
    if (++nodes > limit) return false;
    let best = -1, bc = null, ties = 0;
    for (let i = 0; i < n; i++) {
      if (assign[i] >= 0) continue;
      const c = cand(i, useC);
      if (!c.length) return false;
      if (!bc || c.length < bc.length) { best = i; bc = c; ties = 1; }
      else if (c.length === bc.length && Math.random() < 1 / ++ties) { best = i; bc = c; }
    }
    const order = bc.map(s => [s, score(best, s)]).sort((x, y) => y[1] - x[1]);
    for (const [s] of order) {
      assign[best] = s; occ[s] = best;
      if (rec(count + 1, useC)) return true;
      assign[best] = -1; occ[s] = -1;
      if (nodes > limit) return false;
    }
    return false;
  };
  const attempt = (useC, lim) => { assign = Array(n).fill(-1); occ = Array(seats.length).fill(-1); nodes = 0; limit = lim; return rec(0, useC); };

  const t0 = performance.now();
  let ok = false;
  while (performance.now() - t0 < 1500) {
    strict = hasHist && performance.now() - t0 < 1000;   // 처음엔 이전 짝 금지를 필수로, 안 되면 가능한 한 피하기로 완화
    if ((ok = attempt(true, 4000))) break;
  }
  strict = false;

  const warnings = [];
  if (!ok) {
    if (!attempt(false, 200000)) throw new Error('고정석·범위 조건끼리 충돌해서 배치할 수 없어요.\n조건을 확인해 주세요.');
    const dom = domain.map(d => new Set(d));
    const violations = () => {
      let v = 0;
      for (const [a, b, pm] of pairs) if (!pairOK(assign[a], assign[b], pm)) v++;
      for (const [a, b, d] of seps) if (!sepOK(assign[a], assign[b], d)) v++;
      return v;
    };
    let cur = violations();
    const movable = S.map((_, i) => i).filter(i => !isFixed[i] && domain[i].length > 1);
    for (let it = 0; it < 40000 && cur > 0 && movable.length; it++) {
      const i = movable[(Math.random() * movable.length) | 0];
      const s = domain[i][(Math.random() * domain[i].length) | 0], old = assign[i];
      if (s === old) continue;
      const j = occ[s];
      if (j >= 0 && (isFixed[j] || !dom[j].has(old))) continue;
      assign[i] = s; occ[s] = i; occ[old] = -1;
      if (j >= 0) { assign[j] = old; occ[old] = j; }
      const nv = violations();
      if (nv <= cur) cur = nv;
      else { assign[i] = old; occ[old] = i; occ[s] = -1; if (j >= 0) { assign[j] = s; occ[s] = j; } }
    }
    warnings.push('모든 조건을 동시에 만족하는 배치를 찾지 못해 최대한 가깝게 배치했어요.');
    for (const [a, b, pm] of pairs) if (!pairOK(assign[a], assign[b], pm)) warnings.push(`붙이기 미충족: ${label(S[a])} · ${label(S[b])}`);
    for (const [a, b, d] of seps) if (!sepOK(assign[a], assign[b], d)) warnings.push(`떼기 미충족: ${label(S[a])} · ${label(S[b])}`);
  }
  if (hasHist) for (let i = 0; i < n; i++) for (const j of hist[i]) if (j > i && nbrs[assign[i]].includes(assign[j]))
    warnings.push(`이전에 짝이었던 ${label(S[i])} · ${label(S[j])}이(가) 다시 ${gm ? '같은 모둠' : '짝'}이 되었어요.`);

  const out = {};
  S.forEach((s, i) => { const st = seats[assign[i]]; out[s.id] = [st.r, st.c]; });
  return { seats: out, warnings, at: Date.now(), mode: gm ? 'group' : 'seat' };
}

// 확정된 자리에서 "짝"이었던 쌍을 뽑는다 (좌우로 바로 붙은 자리만 인정 → 통로가 끼면 제외 / 모둠은 같은 모둠 전원)
function pairsOfRecord(rec) {
  const out = new Set(), at = {};
  for (const [id, [r, c]] of Object.entries(rec.seats)) at[r + ',' + c] = +id;
  if (rec.mode === 'group') {
    const g = {};
    for (const [id, [r, c]] of Object.entries(rec.seats)) { const k = groupOf(r, c); if (k != null) (g[k] ??= []).push(+id); }
    Object.values(g).forEach(m => { for (let i = 0; i < m.length; i++) for (let j = i + 1; j < m.length; j++) out.add(pairKey(m[i], m[j])); });
  } else {
    for (const [id, [r, c]] of Object.entries(rec.seats)) { const o = at[r + ',' + (c + 1)]; if (o != null) out.add(pairKey(+id, o)); }
  }
  return [...out];
}

/* ================= 자리표 그리기 ================= */
function boardHTML(rec, { mini = false } = {}) {
  const { rows, cols } = state.layout, view = state.view, gmode = rec && rec.mode === 'group';
  const occ = {};
  if (rec) for (const [id, [r, c]] of Object.entries(rec.seats)) if (byId(+id)) occ[r + ',' + c] = byId(+id);
  const fixedIds = new Set(state.fixed.map(f => f.s));
  let rs = [...Array(rows).keys()], cs = [...Array(cols).keys()];
  if (view === 'teacher') { rs.reverse(); cs.reverse(); }   // 교탁에서 바라본 시점 = 180° 회전
  let cells = '';
  for (const r of rs) for (const c of cs) {
    if (isOff(r, c)) { cells += '<div class="seat off"></div>'; continue; }
    const g = gmode ? groupOf(r, c) : null;
    const gs = g ? `style="--gc:${gcolor(g)}"` : '', gcls = g ? 'hasg' : '', gb = g ? `<i class="grp">모둠 ${g}</i>` : '';
    const s = occ[r + ',' + c];
    if (!s) { cells += `<div class="seat vacant ${gcls}" ${gs}>${gb}</div>`; continue; }
    cells += `<div class="seat ${s.gender} ${gcls}" ${gs} data-sid="${s.id}" data-name="${esc(label(s))}" data-no="${esc(s.no)}">
      <span class="no">${esc(s.no)}</span><span class="nm">${esc(label(s))}</span>${fixedIds.has(s.id) ? '<i class="pin">고정</i>' : ''}${gb}</div>`;
  }
  const D = dims();
  const units = Math.max(1, cs.reduce((u, c) => u + (D.aisleCols[c] ? 0.5 : 1), 0));
  const tcols = cs.map(c => (D.aisleCols[c] ? 'minmax(0,.5fr)' : 'minmax(0,1fr)')).join(' ');
  const trows = rs.map(r => (D.aisleRows[r] ? 'calc(var(--u) / 3)' : 'calc(var(--u) / 1.5)')).join(' ');   // 통로 = 책상의 절반
  const podium = '<div class="podium">교탁</div>';
  return `<div class="board ${mini ? 'mini' : ''}">${view === 'student' ? podium : ''}<div class="seats-wrap" style="--units:${units}"><div class="seats" style="--cols:${cols};--units:${units};--tcols:${tcols};--trows:${trows}">${cells}</div></div>${view === 'teacher' ? podium : ''}</div>`;
}
const fmtTime = t => new Date(t).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const warnHTML = w => w && w.length ? `<div class="problems" style="margin-top:8px"><ul>${w.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '';

/* ================= ② 자리 배치 탭 ================= */
function syncViewSeg() { $$('#viewSeg button, #viewSeg2 button').forEach(b => b.classList.toggle('on', b.dataset.view === state.view)); }

function renderShuffle() {
  syncViewSeg();
  $('#showAll').checked = state.showAll;
  $('#slotBar').innerHTML = state.slots.map((s, i) =>
    `<button class="slot ${s ? 'filled' : ''} ${i === state.activeSlot && !state.showAll ? 'active' : ''}" data-slot="${i}" ${state.showAll ? 'disabled' : ''}>슬롯 ${i + 1}${s ? ' ♥' : ''}</button>`).join('');
  const errs = validate(), pb = $('#problems');
  pb.hidden = !errs.length; pb.classList.toggle('bad', !!errs.length);
  // 배치할 수 없는 상태(학생 수 > 좌석 수 등)에서는 배치 버튼을 막는다. 사유는 위 안내 상자에 표시됨
  const blocked = errs.length > 0;
  const setDis = (act, v, tip) => { const b = $(`.toolbar [data-act="${act}"]`); if (b) { b.disabled = v; b.title = v && tip ? tip : ''; } };
  setDis('shuffle', blocked || state.showAll, blocked ? '위 안내를 먼저 해결해 주세요' : '"한 번에 보기"에서는 각 슬롯의 버튼을 사용하세요');
  setDis('fill-all', blocked, '위 안내를 먼저 해결해 주세요');
  setDis('clear-slot', state.showAll, '"한 번에 보기"에서는 각 슬롯의 버튼을 사용하세요');
  setDis('confirm-slot', state.showAll, '"한 번에 보기"에서는 각 슬롯의 버튼을 사용하세요');
  pb.innerHTML = errs.length ? `<b>배치 전에 확인해 주세요</b><ul>${errs.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
  const area = $('#shuffleArea');
  const modeTxt = s => (s.mode === 'group' ? ' · 모둠 배치' : '');
  if (state.showAll) {
    area.innerHTML = '<div class="all-grid">' + state.slots.map((s, i) => `
      <div class="slot-card ${i === state.activeSlot ? 'active' : ''}" id="slotcard-${i}">
        <header><b>슬롯 ${i + 1}</b>
          <button class="btn small" data-act="shuffle" data-i="${i}" ${blocked ? 'disabled' : ''}>${s ? '다시 배치' : '배치'}</button>
          <button class="btn small good" data-act="confirm-slot" data-i="${i}" ${s ? '' : 'disabled'}>확정</button>
          <button class="btn small" data-act="clear-slot" data-i="${i}" ${s ? '' : 'disabled'}>비우기</button></header>
        ${s ? boardHTML(s, { mini: true }) + warnHTML(s.warnings) : '<div class="empty-board">비어 있음</div>'}
      </div>`).join('') + '</div>';
  } else {
    const s = state.slots[state.activeSlot];
    area.innerHTML = s
      ? `<div id="slotcard-${state.activeSlot}">${boardHTML(s)}<p class="meta">슬롯 ${state.activeSlot + 1} · ${fmtTime(s.at)} 배치${modeTxt(s)}</p>${warnHTML(s.warnings)}</div>`
      : `<div class="empty-board">슬롯 ${state.activeSlot + 1}은(는) 비어 있어요.<br>위의 <b>자리 배치!</b> 버튼을 눌러 보세요.</div>`;
  }
}

/* ---- 연출 ---- */
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function prepareSpin(root) {
  const seats = $$('.seat[data-sid]', root);
  seats.forEach(el => { el.classList.add('spin'); el.querySelector('.nm').textContent = '?'; el.querySelector('.no').textContent = ''; });
  return seats;
}
function runSpin(seats, skipP) {
  return new Promise(res => {
    const total = 2600, t0 = performance.now(), names = state.students.map(label);
    seats.forEach(el => (el._lock = 500 + Math.random() * (total - 500)));
    const lock = el => {
      if (el._locked) return; el._locked = true;
      el.classList.remove('spin'); el.classList.add('lock');
      el.querySelector('.nm').textContent = el.dataset.name; el.querySelector('.no').textContent = el.dataset.no;
    };
    let iv; const finish = () => { clearInterval(iv); seats.forEach(lock); res(); };
    iv = setInterval(() => {
      const t = performance.now() - t0; let left = 0;
      seats.forEach(el => {
        if (el._locked) return;
        if (t >= el._lock) lock(el); else { left++; el.querySelector('.nm').textContent = names[(Math.random() * names.length) | 0]; }
      });
      if (!left) finish();
    }, 70);
    skipP.then(finish);
  });
}
function confetti() {
  const cv = $('#confetti'); cv.hidden = false; cv.width = innerWidth; cv.height = innerHeight;
  const ctx = cv.getContext('2d');
  const ps = Array.from({ length: 150 }, () => ({ x: innerWidth / 2 + (Math.random() - .5) * 240, y: innerHeight * .4, vx: (Math.random() - .5) * 15, vy: -Math.random() * 14 - 4, s: 6 + Math.random() * 6, c: `hsl(${Math.random() * 360} 85% 70%)`, r: Math.random() * 6, vr: (Math.random() - .5) * .4 }));
  let f = 0;
  (function loop() {
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (const p of ps) { p.vy += .35; p.x += p.vx; p.y += p.vy; p.r += p.vr; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * .6); ctx.restore(); }
    if (++f < 120) requestAnimationFrame(loop); else cv.hidden = true;
  })();
}

async function playShuffle(applyFn, roots = ['#shuffleArea']) {
  if (busy) return;
  busy = true;
  const anim = state.settings.animation && !reduceMotion();
  const ov = $('#overlay'); let skip; const skipP = new Promise(r => (skip = r));
  let textTimer;
  try {
    if (anim) {
      const msgs = ['자리를 섞는 중…', '누가 어디에 앉게 될까요?', '두구두구두구…'];
      let k = 0; $('#overlayText').textContent = msgs[0];
      textTimer = setInterval(() => ($('#overlayText').textContent = msgs[++k % msgs.length]), 650);
      ov.hidden = false; ov.onclick = () => skip();
      await sleep(60);
    }
    const t0 = performance.now();
    applyFn(); save();
    if (anim) await Promise.race([sleep(Math.max(0, 1900 - (performance.now() - t0))), skipP]);
    renderShuffle();
    if (anim) {
      const seats = roots.map(sel => $(sel)).filter(Boolean).flatMap(el => prepareSpin(el));
      clearInterval(textTimer); ov.hidden = true;
      const onDown = () => skip(); document.addEventListener('pointerdown', onDown, { once: true });
      await runSpin(seats, skipP);
      document.removeEventListener('pointerdown', onDown);
      confetti();
    }
  } catch (e) {
    clearInterval(textTimer); ov.hidden = true; busy = false;
    renderShuffle(); await notify(e.message || '배치 중 오류가 발생했어요.', '배치할 수 없어요');
  } finally {
    clearInterval(textTimer); ov.hidden = true; busy = false;
  }
}

async function actShuffle(i) {
  if (validate().length) return;
  state.activeSlot = i;
  playShuffle(() => { state.slots[i] = solve(); }, [`#slotcard-${i}`]);
}
async function actFillAll() {
  if (validate().length) return;
  const empties = state.slots.map((s, i) => (s ? -1 : i)).filter(i => i >= 0);
  if (!empties.length) { await notify('빈 슬롯이 없어요.\n슬롯을 비우거나 개별로 다시 배치해 주세요.'); return; }
  state.showAll = true;
  playShuffle(() => { empties.forEach(i => (state.slots[i] = solve())); }, empties.map(i => `#slotcard-${i}`));
}
async function actConfirm(i) {
  const s = state.slots[i];
  if (!s) { await notify('비어 있는 슬롯이에요.'); return; }
  if (!await ask(`슬롯 ${i + 1}의 자리를 최종 자리로 확정할까요?\n나머지 임시 저장 자리는 모두 삭제돼요.`, { title: '최종 자리 확정', ok: '확정하기' })) return;
  const add = pairsOfRecord(s);
  state.pairHistory = [...new Set([...state.pairHistory, ...add])];
  state.final = { seats: s.seats, warnings: s.warnings, at: Date.now(), mode: s.mode };
  state.slots = Array(SLOT_N).fill(null); state.activeSlot = 0;
  save(); showTab('final'); toast(`최종 자리가 저장되었어요. (짝 기록 +${add.length}쌍)`);
}

/* ================= ③ 확정된 자리 ================= */
function renderFinal() {
  syncViewSeg();
  const f = state.final, area = $('#finalArea');
  if (!f) { area.innerHTML = '<div class="empty-board">아직 확정된 자리가 없어요.<br>② 자리 배치에서 마음에 드는 슬롯을 확정해 주세요.</div>'; return; }
  area.innerHTML = `<div class="print-title">${esc(state.className || '우리반')} 자리 배치표</div>${boardHTML(f)}
    <p class="meta">${esc(state.className || '')} · ${fmtTime(f.at)} 확정${f.mode === 'group' ? ' · 모둠 배치' : ''} · ${state.view === 'teacher' ? '교사용(교탁에서 본 시점)' : '학생용(교탁을 바라보는 시점)'}</p>${warnHTML(f.warnings)}`;
}

/* ================= 탭 ================= */
function showTab(name) {
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  $$('.panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
  if (name === 'setup') renderSetup();
  if (name === 'shuffle') renderShuffle();
  if (name === 'final') renderFinal();
  window.scrollTo(0, 0);
}
const currentTab = () => ($('.tab.active') || {}).dataset?.tab;

/* ================= 저장 파일(JSON) ================= */
function saveJson() {
  download(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }), `${fileBase()}_자리바꾸기_저장_${today()}.json`);
}
function loadJson(file) {
  const fr = new FileReader();
  fr.onload = async () => {
    let o;
    try {
      o = JSON.parse(fr.result);
      if (!o || !Array.isArray(o.students) || !o.layout) throw new Error('형식 오류');
    } catch (e) { await notify('올바른 저장 파일이 아니에요.', '불러오지 못했어요'); return; }
    if (!await ask('현재 작업 내용이 저장 파일의 내용으로 바뀌어요.\n계속할까요?', { ok: '불러오기' })) return;
    state = migrate(o); save(); renderAllCurrent(); toast('저장 파일을 불러왔어요.');
  };
  fr.readAsText(file);
}
function renderAllCurrent() { showTab(currentTab() || 'setup'); }

/* ================= 엑셀 ================= */
async function needXlsx() { if (typeof XLSX === 'undefined') { await notify('엑셀 라이브러리를 불러오지 못했어요.'); return false; } return true; }
const OPT = { side: '좌우', around: '주변' };
const PAIR_LABEL = { side: '좌우로 나란히', around: '주변 8칸' };

function buildWorkbook(src) {
  const wb = XLSX.utils.book_new();
  const add = (name, aoa, widths) => { const ws = XLSX.utils.aoa_to_sheet(aoa); if (widths) ws['!cols'] = widths.map(w => ({ wch: w })); XLSX.utils.book_append_sheet(wb, ws, name); };
  const nm = id => { const s = src.students.find(x => x.id === id); return s ? s.name || s.no : ''; };
  const L = src.layout, D = dimsOf(L);
  add('안내', [
    ['우리반 자리 바꾸기 — 엑셀 작성 안내'], [''],
    ['[학생명단] 번호(자동 연번) / 이름 / 성별(남·여). 번호 칸은 비워도 되고, 위에서부터 1, 2, 3… 순서로 매겨집니다.'],
    ['[좌석배열] 위쪽 줄이 교탁에 가까운 앞줄, 왼쪽이 학생이 앉아서 본 왼쪽. 책상 있는 칸 = 1, 빈 칸·통로 = 0'],
    ['[모둠] 좌석배열과 같은 크기의 표에 모둠 번호를 적습니다 (모둠 배치를 쓸 때만, 없는 칸은 0)'],
    ['[붙이기] 붙여 앉힐 두 학생 (번호 또는 이름)과 방식(좌우/주변, 비우면 설정 시트의 붙이기방식). 모둠 배치에서는 같은 모둠'],
    ['[떼기] 떼어 앉힐 두 학생과 최소 반경(칸). 비우면 2칸. 반경 = 줄 차이와 열 차이 중 큰 값. 모둠 배치에서는 다른 모둠'],
    ['[고정석] 학생 / 행 / 열 — 통로(책상이 하나도 없는 줄·열)를 뺀 번호. 행 1 = 맨 앞줄, 열 1 = 맨 왼쪽'],
    ['[범위] 학생 / 시작행 / 끝행 / 시작열 / 끝열 (같은 학생을 여러 줄 적으면 합쳐서 적용)'],
    ['[이전짝] 예전에 짝(또는 같은 모둠)이었던 두 학생. 앱에서 확정할 때마다 자동으로 쌓입니다.'],
    ['[설정] 배치방식(일반/모둠), 붙이기방식(좌우/주변), 남녀섞기, 이전자리피하기, 이전짝피하기(O/X)'],
  ], [110]);
  add('학생명단', [['번호', '이름', '성별'], ...src.students.map((s, i) => [i + 1, s.name, s.gender === 'M' ? '남' : s.gender === 'F' ? '여' : ''])], [8, 16, 8]);
  const grid = [], gg = [];
  for (let r = 0; r < L.rows; r++) {
    const row = [], grow = [];
    for (let c = 0; c < L.cols; c++) { const off = L.disabled.includes(r + ',' + c); row.push(off ? 0 : 1); grow.push(off ? 0 : (L.groups[r + ',' + c] || 0)); }
    grid.push(row); gg.push(grow);
  }
  add('좌석배열', grid, Array(L.cols).fill(5));
  add('모둠', gg, Array(L.cols).fill(5));
  add('붙이기', [['학생1', '학생2', '방식(좌우/주변)'], ...src.pairs.map(p => [nm(p.a), nm(p.b), OPT[p.mode || src.settings.pairMode]])], [14, 14, 16]);
  add('떼기', [['학생1', '학생2', '최소반경(칸)'], ...src.seps.map(p => [nm(p.a), nm(p.b), p.d])], [14, 14, 14]);
  add('고정석', [['학생', '행', '열'], ...src.fixed.map(f => [nm(f.s), upTo(D.realRows, f.r), upTo(D.realCols, f.c)])], [14, 8, 8]);
  const rangeRows = [];
  for (const g of src.ranges) {
    if (!g.cells) { rangeRows.push([nm(g.s), before(D.realRows, g.r1) + 1, upTo(D.realRows, g.r2), before(D.realCols, g.c1) + 1, upTo(D.realCols, g.c2)]); continue; }
    // 자유 지정은 행마다 연속 구간으로 나눠 여러 줄로 저장 (같은 학생은 합쳐서 적용됨)
    const byRow = {};
    g.cells.forEach(k => { const [r, c] = k.split(',').map(Number); (byRow[r] ??= []).push(c); });
    Object.entries(byRow).forEach(([r, cs]) => {
      cs.sort((a, b) => a - b);
      let st = cs[0], pv = cs[0];
      const push = (a, b) => rangeRows.push([nm(g.s), upTo(D.realRows, +r), upTo(D.realRows, +r), before(D.realCols, a) + 1, upTo(D.realCols, b)]);
      for (let i = 1; i <= cs.length; i++) { if (cs[i] !== pv + 1) { push(st, pv); st = cs[i]; } pv = cs[i]; }
    });
  }
  add('범위', [['학생', '시작행', '끝행', '시작열', '끝열'], ...rangeRows], [14, 8, 8, 8, 8]);
  add('이전짝', [['학생1', '학생2'], ...src.pairHistory.map(k => k.split('-').map(Number).map(nm))], [14, 14]);
  const st = src.settings;
  add('설정', [['항목', '값'], ['배치방식', st.mode === 'group' ? '모둠' : '일반'], ['붙이기방식', OPT[st.pairMode]], ['남녀섞기', st.mix ? 'O' : 'X'], ['이전자리피하기', st.avoidPrev ? 'O' : 'X'], ['이전짝피하기', st.avoidPast ? 'O' : 'X'], ['학급이름', src.className || '']], [16, 16]);
  return wb;
}

async function exportXlsx() { if (!await needXlsx()) return; XLSX.writeFile(buildWorkbook(state), `${fileBase()}_자리설정_${today()}.xlsx`); }
async function templateXlsx() { if (!await needXlsx()) return; XLSX.writeFile(buildWorkbook(defaultState()), '자리바꾸기_엑셀양식.xlsx'); }

async function importXlsx(file) {
  if (!await needXlsx()) return;
  const fr = new FileReader();
  fr.onload = async () => {
    try {
      const wb = XLSX.read(fr.result, { type: 'array' });
      const rowsOf = name => { const ws = wb.Sheets[name]; return ws ? XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false }) : null; };
      const warn = [];
      const next = migrate(JSON.parse(JSON.stringify(state)));

      let sr = rowsOf('학생명단');
      if (!sr && wb.SheetNames.length === 1) sr = rowsOf(wb.SheetNames[0]);
      if (sr) {
        next.students = []; next.nextId = 1; next.pairHistory = [];
        sr.slice(1).filter(r => String(r[1] ?? '').trim() !== '').forEach((r, i) => {
          const o = parseInt(r[0], 10);
          next.students.push({ id: next.nextId++, no: i + 1, name: String(r[1]).trim(), gender: parseGender(r[2]), _orig: Number.isFinite(o) ? o : i + 1 });
        });
      } else next.students.forEach(s => (s._orig = s.no));

      const lr = rowsOf('좌석배열');
      if (lr) {
        const on = v => v === 1 || v === true || ['1', 'o', 'O', '○', 'ㅇ', 'y', 'Y'].includes(String(v).trim());
        const g = lr.map(r => r.map(v => (v === '' ? '' : on(v) ? 1 : 0)));
        while (g.length && g[g.length - 1].every(v => v === '')) g.pop();
        const cols = Math.min(MAX_DIM, g.reduce((m, r) => { let k = r.length; while (k > 0 && r[k - 1] === '') k--; return Math.max(m, k); }, 0));
        if (g.length && cols) {
          const rows = Math.min(MAX_DIM, g.length), dis = [];
          for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (g[r][c] !== 1) dis.push(r + ',' + c);
          next.layout = { rows, cols, disabled: dis, groups: {} };
        }
      }
      const L = next.layout, D = dimsOf(L);
      const gr = rowsOf('모둠');
      if (gr) gr.forEach((row, r) => row.forEach((v, c) => { const n = parseInt(v, 10); if (n > 0 && r < L.rows && c < L.cols && !L.disabled.includes(r + ',' + c)) L.groups[r + ',' + c] = n; }));

      const find = tok => {
        const t = String(tok ?? '').trim(); if (!t) return null;
        if (/^\d+$/.test(t)) { const s = next.students.find(x => x._orig === +t); if (s) return s; }
        return next.students.find(x => x.name === t) || null;
      };
      const dataRows = n => (rowsOf(n) || []).slice(1).filter(r => String(r[0] ?? '').trim() !== '' || String(r[1] ?? '').trim() !== '');
      const settings = next.settings;
      for (const r of (rowsOf('설정') || []).slice(1)) {
        const k = String(r[0]).trim(), v = String(r[1]).trim(), yes = /^(o|O|예|y|Y|1|true)/.test(v);
        if (k === '배치방식') settings.mode = v.startsWith('모둠') ? 'group' : 'seat';
        else if (k === '붙이기방식') settings.pairMode = v.startsWith('주변') ? 'around' : 'side';
        else if (k === '남녀섞기') settings.mix = yes;
        else if (k === '이전자리피하기') settings.avoidPrev = yes;
        else if (k === '이전짝피하기') settings.avoidPast = yes;
        else if (k === '학급이름') next.className = v;
      }
      next.pairs = []; next.seps = []; next.fixed = []; next.ranges = [];
      if (rowsOf('이전짝') || sr) next.pairHistory = [];
      dataRows('붙이기').forEach((r, i) => {
        const a = find(r[0]), b = find(r[1]);
        if (!a || !b || a === b) return warn.push(`붙이기 ${i + 2}행: 학생을 찾지 못했어요 (${r[0]}, ${r[1]})`);
        const m = String(r[2] ?? '').trim();
        next.pairs.push({ a: a.id, b: b.id, mode: m.startsWith('주변') ? 'around' : m.startsWith('좌우') ? 'side' : settings.pairMode });
      });
      dataRows('떼기').forEach((r, i) => {
        const a = find(r[0]), b = find(r[1]);
        if (!a || !b || a === b) return warn.push(`떼기 ${i + 2}행: 학생을 찾지 못했어요 (${r[0]}, ${r[1]})`);
        const d = parseFloat(r[2]);
        next.seps.push({ a: a.id, b: b.id, d: d > 0 ? normSep(d) : 2 });
      });
      dataRows('고정석').forEach((r, i) => {
        const s = find(r[0]), rr = D.realRows[parseInt(r[1], 10) - 1], cc = D.realCols[parseInt(r[2], 10) - 1];
        if (!s || rr == null || cc == null || L.disabled.includes(rr + ',' + cc)) return warn.push(`고정석 ${i + 2}행: 학생 또는 위치가 올바르지 않아요 (${r[0]}, ${r[1]}, ${r[2]})`);
        next.fixed = next.fixed.filter(f => f.s !== s.id); next.fixed.push({ s: s.id, r: rr, c: cc });
      });
      dataRows('범위').forEach((r, i) => {
        const s = find(r[0]); const v = [1, 2, 3, 4].map(k => parseInt(r[k], 10));
        const R = [Math.min(v[0], v[1]), Math.max(v[0], v[1])].map(x => D.realRows[x - 1]);
        const C = [Math.min(v[2], v[3]), Math.max(v[2], v[3])].map(x => D.realCols[x - 1]);
        if (!s || v.some(x => !(x >= 1)) || R.includes(undefined) || C.includes(undefined)) return warn.push(`범위 ${i + 2}행: 학생 또는 숫자가 올바르지 않아요 (${r[0]})`);
        next.ranges.push({ s: s.id, r1: R[0], r2: R[1], c1: C[0], c2: C[1] });
      });
      dataRows('이전짝').forEach((r, i) => {
        const a = find(r[0]), b = find(r[1]);
        if (!a || !b || a === b) return warn.push(`이전짝 ${i + 2}행: 학생을 찾지 못했어요 (${r[0]}, ${r[1]})`);
        const k = pairKey(a.id, b.id); if (!next.pairHistory.includes(k)) next.pairHistory.push(k);
      });
      next.students.forEach(s => delete s._orig);

      if (!sr && !lr && !rowsOf('붙이기') && !rowsOf('떼기')) throw new Error('양식에 맞는 시트를 찾지 못했어요.');
      if ((state.slots.some(Boolean) || state.final || state.students.length) &&
        !await ask('엑셀 내용으로 현재 설정이 바뀌어요.\n(임시 저장·확정된 자리는 초기화돼요)\n계속할까요?', { ok: '올리기', title: '엑셀 올리기' })) return;
      next.slots = Array(SLOT_N).fill(null); next.final = null; next.activeSlot = 0;
      state = next; save(); pend.fixed = pend.range = null; renderAllCurrent();
      if (warn.length) await notify(`엑셀을 불러왔어요. (학생 ${state.students.length}명, 좌석 ${seatCount()}개)\n\n확인이 필요한 항목:\n` + warn.slice(0, 8).join('\n') + (warn.length > 8 ? `\n…외 ${warn.length - 8}건` : ''), '불러왔어요');
      else toast(`엑셀을 불러왔어요. (학생 ${state.students.length}명, 좌석 ${seatCount()}개)`);
    } catch (e) { await notify('엑셀을 읽지 못했어요.\n' + (e.message || e), '불러오지 못했어요'); }
  };
  fr.readAsArrayBuffer(file);
}

async function exportFinalXlsx() {
  if (!await needXlsx()) return;
  if (!state.final) { await notify('확정된 자리가 없어요.'); return; }
  const { rows, cols } = state.layout, occ = {};
  for (const [id, [r, c]] of Object.entries(state.final.seats)) occ[r + ',' + c] = label(byId(+id));
  let rs = [...Array(rows).keys()], cs = [...Array(cols).keys()];
  if (state.view === 'teacher') { rs.reverse(); cs.reverse(); }
  const aoa = [];
  const podium = [...Array(cols)].map((_, i) => (i === Math.floor((cols - 1) / 2) ? '[ 교탁 ]' : ''));
  if (state.view === 'student') aoa.push(podium);
  rs.forEach(r => aoa.push(cs.map(c => (isOff(r, c) ? '' : occ[r + ',' + c] || '(빈자리)'))));
  if (state.view === 'teacher') aoa.push(podium);
  const wb = XLSX.utils.book_new(), ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = Array(cols).fill({ wch: 12 });
  XLSX.utils.book_append_sheet(wb, ws, state.view === 'teacher' ? '교사용' : '학생용');
  XLSX.writeFile(wb, `${fileBase()}_자리배치표_${today()}.xlsx`);
}

/* ================= 모둠 편집 ================= */
function autoGroups(w, h) {
  const { rows, cols } = state.layout, D = dims();
  const segs = arr => {
    const out = []; let s = null;
    arr.forEach((a, i) => {
      if (!a && s == null) s = i;
      if ((a || i === arr.length - 1) && s != null) { out.push([s, a ? i - 1 : i]); s = null; }
    });
    return out;
  };
  const rsg = segs(D.aisleRows), csg = segs(D.aisleCols), groups = {}; let g = 0;
  for (const [rs0, rs1] of rsg) for (let r0 = rs0; r0 <= rs1; r0 += h) for (const [cs0, cs1] of csg) for (let c0 = cs0; c0 <= cs1; c0 += w) {
    g++; let any = false;
    for (let r = r0; r <= Math.min(r0 + h - 1, rs1); r++) for (let c = c0; c <= Math.min(c0 + w - 1, cs1); c++)
      if (!isOff(r, c)) { groups[r + ',' + c] = g; any = true; }
    if (!any) g--;
  }
  state.layout.groups = groups;
  return g;
}

/* ================= 도움말 모달 (오른쪽 위 X로만 닫힘) ================= */
let helpClosing = false;
function openHelp(title, html) {
  $('#helpTitle').textContent = title; $('#helpBody').innerHTML = html;
  helpClosing = false; $('#helpModal').showModal();
}
{
  const d = $('#helpModal');
  d.addEventListener('cancel', e => e.preventDefault());                       // Esc 무시
  d.addEventListener('close', () => { if (!helpClosing) d.showModal(); });     // X가 아닌 방식으로 닫히면 다시 연다
}

/* ================= 이벤트 ================= */
document.addEventListener('click', async e => {
  const t = e.target.closest('button, [data-goto]'); if (!t) return;

  if (t.dataset.tab) { if (!busy) showTab(t.dataset.tab); return; }
  if (t.dataset.goto) { showTab(t.dataset.goto); return; }
  if (t.dataset.view) { if (busy) return; state.view = t.dataset.view; save(); currentTab() === 'final' ? renderFinal() : renderShuffle(); return; }
  if (t.dataset.slot != null) { if (busy) return; state.activeSlot = +t.dataset.slot; save(); renderShuffle(); return; }
  if (t.dataset.edit) { editMode = t.dataset.edit; renderLayout(); return; }

  // 좌석 편집
  if (t.dataset.lay) {
    const k = t.dataset.lay, [r, c] = k.split(',').map(Number);
    if (editMode === 'group') {
      if (isOff(r, c)) return;
      if (state.settings.mode === 'group' && !await guard()) return;
      const g = Math.max(1, parseInt($('#grpNo').value, 10) || 1);
      if (state.layout.groups[k] === g) delete state.layout.groups[k]; else state.layout.groups[k] = g;
      save(); renderLayout(); return;
    }
    if (!await guard()) return;
    const a = state.layout.disabled, i = a.indexOf(k);
    i >= 0 ? a.splice(i, 1) : (a.push(k), delete state.layout.groups[k]);
    pruneConstraints(); save(); renderLayout(); renderConstraints(); return;
  }
  if (t.dataset.layRow != null || t.dataset.layCol != null) {
    if (!await guard()) return;
    const { rows, cols, disabled } = state.layout;
    const keys = t.dataset.layRow != null ? [...Array(cols)].map((_, c) => t.dataset.layRow + ',' + c) : [...Array(rows)].map((_, r) => r + ',' + t.dataset.layCol);
    const allOff = keys.every(k => disabled.includes(k));
    state.layout.disabled = disabled.filter(k => !keys.includes(k));
    if (!allOff) { state.layout.disabled.push(...keys); keys.forEach(k => delete state.layout.groups[k]); }
    pruneConstraints(); save(); renderLayout(); renderConstraints(); return;
  }
  if (t.dataset.delStudent != null) { await removeStudent(+t.dataset.delStudent); return; }
  if (t.dataset.del) { const [k, i] = t.dataset.del.split(':'); state[k].splice(+i, 1); save(); renderConstraints(); return; }

  // 좌석 선택 창 격자
  if (t.classList.contains('pk')) {
    const r = +t.dataset.r, c = +t.dataset.c;
    if (pk.mode === 'cell') pk.sel = { r, c };
    else if (pk.tool === 'cell') return;   // 칸 하나씩·드래그는 포인터 이벤트에서 처리
    else if (!pk.anchor) pk.anchor = { r, c };
    else { addRect(pk.anchor.r, pk.anchor.c, r, c); pk.anchor = null; }
    drawPicker(); return;
  }

  const act = t.dataset.act; if (!act) return;
  const idx = t.dataset.i != null ? +t.dataset.i : state.activeSlot;
  if (busy && act !== 'picker-cancel') return;
  switch (act) {
    case 'sep-help': openHelp('떼어 앉힐 학생 — 반경이란?', `
      <p>반경은 한 학생의 자리를 <b>중심으로 한 정사각형 범위</b>로 잽니다. 두 자리의 줄 차이와 열 차이 중 <b>큰 값</b>이 반경 이상이어야 떼어 앉힌 것으로 봐요.</p>
      <ul>
        <li><b>반경 2칸</b> : 바로 옆·앞뒤·대각선에는 앉을 수 없고, 한 칸 건너 앉는 것은 가능해요.</li>
        <li><b>반경 3칸</b> : 두 칸 이상 떨어져야 해요.</li>
        <li>선택할 수 있는 최댓값은 좌석 배열에 맞춰 자동으로 정해져요.</li>
        <li>통로 줄·열도 1칸으로 계산해요.</li>
        <li>모둠 배치에서는 반경 대신 <b>"다른 모둠"</b>이면 떼어 앉힌 것으로 봐요.</li>
      </ul>`); break;
    case 'help-close': helpClosing = true; $('#helpModal').close(); break;
    case 'save-json': saveJson(); break;
    case 'load-json': $('#fileJson').click(); break;
    case 'xlsx-template': templateXlsx(); break;
    case 'xlsx-import': $('#fileXlsx').click(); break;
    case 'xlsx-export': exportXlsx(); break;
    case 'add-student': {
      if (!await guard()) break;
      addStudent(); save(); renderStudents(); renderConstraints();
      if (enforceMix()) { renderOptions(); toast('성별이 지정되지 않은 학생이 있어 "남녀 섞어 앉히기"를 해제했어요.', 3600); }
      const inputs = $$('#studentTable input[data-f=name]'); inputs[inputs.length - 1]?.focus();
      $('.table-wrap').scrollTop = 1e6; break;
    }
    case 'bulk-open': $('#bulkBox').hidden = false; $('#bulkText').focus(); break;
    case 'bulk-close': $('#bulkBox').hidden = true; break;
    case 'bulk-apply': {
      const lines = $('#bulkText').value.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      if (!lines.length) break;
      if (!await guard()) break;
      lines.forEach(l => {
        let p = l.split(/[\t,]+|\s+/).filter(Boolean);
        if (p.length >= 2 && /^\d+$/.test(p[0])) p = p.slice(1);   // 앞의 번호는 무시(자동 연번)
        addStudent(p[0], parseGender(p[1]));
      });
      $('#bulkText').value = ''; $('#bulkBox').hidden = true;
      save(); renderStudents(); renderConstraints(); toast(`${lines.length}명을 추가했어요.`);
      if (enforceMix()) { renderOptions(); toast('성별이 지정되지 않은 학생이 있어 "남녀 섞어 앉히기"를 해제했어요.', 3600); } break;
    }
    case 'clear-students':
      if (!state.students.length) break;
      if (!await ask('학생 명단과 모든 조건(붙이기·떼기·고정석·범위·짝 기록)을 삭제할까요?', { ok: '모두 삭제', danger: true })) break;
      if (!await guard()) break;
      state.students = []; state.pairs = []; state.seps = []; state.fixed = []; state.ranges = []; state.pairHistory = [];
      save(); renderStudents(); renderConstraints(); renderOptions(); break;
    case 'lay-reset':
      if (!await ask('모든 칸을 책상으로 바꿀까요?\n통로·빈 칸으로 지정한 곳이 모두 책상이 돼요.', { title: '모두 책상으로', ok: '모두 책상으로' })) break;
      if (!await guard()) break; state.layout.disabled = []; save(); renderLayout(); renderConstraints(); break;

    case 'grp-next': $('#grpNo').value = Math.min(30, (parseInt($('#grpNo').value, 10) || 1) + 1); break;
    case 'grp-auto': {
      if (state.settings.mode === 'group' && !await guard()) break;
      const w = Math.max(1, parseInt($('#grpW').value, 10) || 2), h = Math.max(1, parseInt($('#grpH').value, 10) || 2);
      const n = autoGroups(w, h); save(); renderLayout(); toast(`${n}개의 모둠으로 묶었어요.`); break;
    }
    case 'grp-clear':
      if (!Object.keys(state.layout.groups).length) break;
      if (state.settings.mode === 'group' && !await guard()) break;
      state.layout.groups = {}; save(); renderLayout(); break;

    case 'past-reset':
      if (!state.pairHistory.length) { await notify('지울 짝 기록이 없어요.'); break; }
      if (!await ask(`기록된 짝 ${state.pairHistory.length}쌍을 모두 지울까요?`, { ok: '초기화', danger: true })) break;
      state.pairHistory = []; save(); renderOptions(); break;

    case 'add-pair': case 'add-sep': {
      const k = act === 'add-pair' ? 'pair' : 'sep';
      const a = +$('#' + k + 'A').value, b = +$('#' + k + 'B').value;
      if (!a || !b) { await notify('학생을 선택해 주세요.'); break; }
      const same = p => (p.a === a && p.b === b) || (p.a === b && p.b === a);
      if (state.pairs.some(same) || state.seps.some(same)) { await notify('이미 붙이기/떼기에 지정된 조합이에요.'); break; }
      if (k === 'pair') state.pairs.push({ a, b, mode: $('#optPairMode').value });
      else state.seps.push({ a, b, d: normSep($('#sepD').value) });
      save(); renderConstraints(); break;
    }
    case 'pick-fixed':
      if (!seatCount()) { await notify('먼저 좌석을 만들어 주세요.'); break; }
      openPicker({ title: '고정석 선택', hint: '앉힐 자리를 한 칸 눌러 주세요. (화면 위쪽이 교탁, 표시 숫자는 "행-열")', mode: 'cell', initial: pend.fixed, cb: v => { pend.fixed = v; renderConstraints(); } }); break;
    case 'add-fixed': {
      const s = +$('#fixS').value;
      if (!s || !pend.fixed) { await notify('학생과 자리를 선택해 주세요.'); break; }
      const other = state.fixed.find(f => f.s !== s && f.r === pend.fixed.r && f.c === pend.fixed.c);
      if (other) { await notify(`${label(byId(other.s))}의 고정석과 같은 자리예요.`); break; }
      state.fixed = state.fixed.filter(f => f.s !== s); state.fixed.push({ s, ...pend.fixed });
      pend.fixed = null; save(); renderConstraints(); break;
    }
    case 'pick-range':
      if (!seatCount()) { await notify('먼저 좌석을 만들어 주세요.'); break; }
      openPicker({ title: '범위 선택', hint: '사각형: 두 모서리를 차례로 누르면 그 안의 칸이 추가돼요. 칸 하나씩: 누르거나 드래그해서 칠하고, 다시 누르면 해제돼요. "+" 버튼은 해당 구역을 추가해요.', mode: 'range', initial: pend.range, cb: v => { pend.range = v; renderConstraints(); } }); break;
    case 'add-range': {
      const s = +$('#rngS').value;
      if (!s || !pend.range) { await notify('학생과 구역을 선택해 주세요.'); break; }
      state.ranges.push({ s, ...pend.range }); pend.range = null; save(); renderConstraints(); break;
    }
    case 'picker-cancel': $('#picker').close(); break;
    case 'picker-ok': {
      const v = pk.mode === 'range' ? normalizeSel(pk.set) : pk.sel;
      if (!v) { await notify('먼저 선택해 주세요.'); break; }
      $('#picker').close(); pk.cb(v); break;
    }

    case 'shuffle': actShuffle(idx); break;
    case 'fill-all': actFillAll(); break;
    case 'clear-slot':
      if (!state.slots[idx]) break;
      state.slots[idx] = null; save(); renderShuffle(); break;
    case 'confirm-slot': actConfirm(idx); break;
    case 'print': window.print(); break;
    case 'export-final': exportFinalXlsx(); break;
    case 'drop-final':
      if (state.final && await ask('확정된 자리를 삭제할까요?\n(되돌릴 수 없어요. 쌓인 짝 기록은 그대로 남아요)', { ok: '삭제', danger: true })) { state.final = null; save(); renderFinal(); } break;
  }
});

// 입력 변경
document.addEventListener('change', async e => {
  const t = e.target;
  if (t.matches('#studentTable [data-f]')) {
    const s = state.students[+t.dataset.i], f = t.dataset.f; if (!s) return;
    s[f] = f === 'name' ? t.value.trim() : t.value;
    save(); renderConstraints();
    if (f === 'gender') {
      $('#studentCount').textContent = genderCount();
      if (enforceMix()) { renderOptions(); toast('성별이 지정되지 않은 학생이 있어 "남녀 섞어 앉히기"를 해제했어요.', 3600); }
    }
  } else if (t.id === 'pairA' || t.id === 'sepA') {
    const p = t.id.slice(0, -1), b = $('#' + p + 'B'); b.dataset.sel = b.value; fillPairSelects(p);
  } else if (t.id === 'layRows' || t.id === 'layCols') {
    const rows = Math.min(MAX_DIM, Math.max(1, parseInt($('#layRows').value, 10) || 1));
    const cols = Math.min(MAX_DIM, Math.max(1, parseInt($('#layCols').value, 10) || 1));
    if (rows === state.layout.rows && cols === state.layout.cols) { renderLayout(); return; }
    if (!await guard()) { renderLayout(); return; }
    state.layout.rows = rows; state.layout.cols = cols;
    state.layout.disabled = state.layout.disabled.filter(k => { const [r, c] = k.split(',').map(Number); return r < rows && c < cols; });
    pruneConstraints(); save(); renderLayout(); renderConstraints();
  } else if (t.id === 'optMode') {
    state.settings.mode = t.value; save(); renderOptions();
    if (t.value === 'group' && !Object.keys(state.layout.groups).length)
      await notify('모둠 배치를 쓰려면 먼저 모둠을 만들어야 해요.\n좌석 배열의 "모둠 편집 모드"에서 직접 칠하거나 "자동 묶기"를 눌러 주세요.');
  }
  else if (t.id === 'optPairMode') { state.settings.pairMode = t.value; save(); }
  else if (t.id === 'optMix') {
    if (t.checked && !mixAvailable()) {
      t.checked = false; state.settings.mix = false; save();
      await notify('성별이 지정되지 않은 학생이 있습니다. 모든 학생의 성별을 지정해 주세요.');
    } else { state.settings.mix = t.checked; save(); }
  }
  else if (t.id === 'optAvoid') { state.settings.avoidPrev = t.checked; save(); }
  else if (t.id === 'optPast') { state.settings.avoidPast = t.checked; save(); }
  else if (t.id === 'optAnim') { state.settings.animation = t.checked; save(); }
  else if (t.id === 'showAll') { state.showAll = t.checked; save(); renderShuffle(); }
  else if (t.id === 'fileJson') { if (t.files[0]) loadJson(t.files[0]); t.value = ''; }
  else if (t.id === 'fileXlsx') { if (t.files[0]) importXlsx(t.files[0]); t.value = ''; }
});
$('#className').addEventListener('input', e => { state.className = e.target.value; save(); });

// 좌석이 바뀌었을 때 범위 밖·책상 없는 곳이 된 고정석·범위·모둠 정리
function pruneConstraints() {
  const { rows, cols } = state.layout;
  state.fixed = state.fixed.filter(f => f.r < rows && f.c < cols && !isOff(f.r, f.c));
  state.ranges = state.ranges
    .map(g => (g.cells
      ? { ...g, cells: g.cells.filter(k => { const [r, c] = k.split(',').map(Number); return r < rows && c < cols && !isOff(r, c); }) }
      : (g.r1 < rows && g.c1 < cols ? { ...g, r2: Math.min(g.r2, rows - 1), c2: Math.min(g.c2, cols - 1) } : null)))
    .filter(g => g && (!g.cells || g.cells.length));
  for (const k of Object.keys(state.layout.groups)) { const [r, c] = k.split(',').map(Number); if (r >= rows || c >= cols || isOff(r, c)) delete state.layout.groups[k]; }
  pend.fixed = pend.range = null;
}

window.addEventListener('beforeunload', () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ } });

/* ================= 시작 ================= */
showTab(state.final && !state.slots.some(Boolean) && state.students.length ? 'final' : state.students.length ? 'shuffle' : 'setup');
