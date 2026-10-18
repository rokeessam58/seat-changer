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
  history: [],             // 확정 이력(최신이 앞): {hid, at, seats, mode, warnings, snap:{students,layout,fixed}, note}
  settings: { mode: 'seat', pairMode: 'side', mix: false, avoidPrev: true, avoidPast: true, animation: true, keepHistory: false, historyMax: 10 },
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
  if (!Array.isArray(s.history)) s.history = [];
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
// 결번(vacant)으로 체크한 번호는 없는 학생으로 취급: 인원수·배치·선택 목록에서 모두 제외
const actives = () => state.students.filter(s => !s.vacant);
const label = s => s ? (s.name || `${s.no}번`) : '(삭제됨)';
// 조사 자동 선택: josa('철수', '이/가') → '철수가', josa('영희', '이/가') → '영희가', josa('민준', '이/가') → '민준이'
// pair는 '받침 있을 때/받침 없을 때' 순서: 이/가, 은/는, 을/를, 과/와, 으로/로 (으로/로는 받침 없음·ㄹ받침이면 '로')
function josa(word, pair) {
  const [withB, noB] = pair.split('/'), w = String(word ?? '').trim(), last = w.slice(-1), code = last.charCodeAt(0);
  let has = false, rieul = false;
  if (code >= 0xAC00 && code <= 0xD7A3) { const j = (code - 0xAC00) % 28; has = j !== 0; rieul = j === 8; }
  else if (/[0-9]/.test(last)) { has = '013678'.includes(last); rieul = '178'.includes(last); }
  const useB = pair === '으로/로' ? has && !rieul : has;
  return w + (useB ? withB : noB);
}
const fullLabel = s => s ? `${s.no}번 ${s.name || ''}`.trim() : '(삭제됨)';
const isOff = (r, c) => state.layout.disabled.includes(r + ',' + c);
const seatCount = () => state.layout.rows * state.layout.cols - state.layout.disabled.length;
const groupOf = (r, c) => state.layout.groups[r + ',' + c];
// 범위 제한: 사각형({r1,r2,c1,c2}) 또는 자유 지정({cells:["r,c",...]})
const rangeHas = (g, r, c) => (g.cells ? g.cells.includes(r + ',' + c) : r >= g.r1 && r <= g.r2 && c >= g.c1 && c <= g.c2);
const mixAvailable = () => !actives().some(s => !s.gender);
function enforceMix() {   // 성별 미지정 학생이 있으면 '남녀 섞기'를 자동 해제
  if (state.settings.mix && !mixAvailable()) { state.settings.mix = false; save(); return true; }
  return false;
}
const pairKey = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);
let busy = false;
let editing = null;   // 자리 편집 중이면 {slot, draft:{학생id:[행,열]}, pending:맞교환 첫 번째로 고른 학생id|null, changed}
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

// 여러 명 붙여넣기 창 열기/닫기: 열린 동안 학생 표 자리에 입력창이 대신 뜨고, '여러 명 붙여넣기' 버튼은 선택된 모양(탭처럼 ✕가 붙음)으로 눌리지 않고,
// 추가 버튼이 같은 줄 오른쪽에 나타나며 전체 삭제는 숨겨진다. 닫기는 버튼 안의 ✕로만 한다
function setBulk(open) {
  $('#bulkBox').hidden = !open;
  document.querySelector('.table-wrap').hidden = open;   // 입력창이 표를 밀어내지 않고, 표가 잠시 숨겨진 그 자리에 입력창이 뜬다
  $('#bulkApplyBtn').hidden = !open; $('#bulkOpenBtn .tab-x').hidden = !open;
  document.querySelector('[data-act=clear-students]').hidden = open;
  document.querySelector('[data-act=add-student]').disabled = open;   // 붙여넣기 중에는 학생 추가 버튼 비활성
  const b = $('#bulkOpenBtn'); b.classList.toggle('on', open); b.setAttribute('aria-pressed', open ? 'true' : 'false'); b.tabIndex = open ? -1 : 0;
}
function genderCount() {
  const st = actives(), gap = state.students.length - st.length;
  return `${st.length}명 (남 ${st.filter(s => s.gender === 'M').length} · 여 ${st.filter(s => s.gender === 'F').length})${gap ? ` · 결번 ${gap}` : ''}`;
}
function renderStudents() {
  const st = state.students;
  $('#studentCount').textContent = genderCount();
  $('#studentTable').innerHTML =
    '<tr><th>번호</th><th>이름</th><th>성별</th><th class="vcol">결번</th><th></th></tr>' +
    (st.length ? st.map((s, i) => `<tr class="${s.vacant ? 'vacant-row' : ''}">
      <td class="no">${s.no}</td>
      <td><input type="text" data-i="${i}" data-f="name" value="${s.vacant ? '결번' : esc(s.name)}" maxlength="20" ${s.vacant ? 'disabled' : ''}></td>
      <td><select data-i="${i}" data-f="gender" ${s.vacant ? 'disabled' : ''}>
        <option value="" ${s.gender === '' ? 'selected' : ''}>-</option>
        <option value="M" ${s.gender === 'M' ? 'selected' : ''}>남</option>
        <option value="F" ${s.gender === 'F' ? 'selected' : ''}>여</option></select></td>
      <td class="vcol"><input type="checkbox" data-i="${i}" data-f="vacant" ${s.vacant ? 'checked' : ''} aria-label="${s.no}번 결번"></td>
      <td><button class="x" data-del-student="${i}" title="삭제">✕</button></td></tr>`).join('')
      : '<tr><td colspan="5" class="empty-cell"><div>학생이 없습니다. 추가하거나 엑셀로 올려 주세요.</div></td></tr>');
}

function renderLayout() {
  const { rows, cols, groups } = state.layout, D = dims();
  $('#layRows').value = rows; $('#layCols').value = cols;
  $('#seatSummary').textContent = `좌석 ${seatCount()}개`;
  $$('#editSeg button').forEach(b => b.classList.toggle('on', b.dataset.edit === editMode));
  $('#groupTools').hidden = editMode !== 'group';
  const grpMode = editMode === 'group';
  let h = `<div class="le" style="grid-template-columns:var(--seat-w) repeat(${cols},minmax(var(--seat-w),1fr))"><div class="podium podium-bar" style="grid-column:1/-1;text-align:center">${cols <= 2 ? '교탁' : '교탁(칠판)'}</div><span></span>`;
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
      h += `<button class="cell ${off ? 'off' : 'on'}" data-lay="${r},${c}" ${style}>${off ? '' : (g || '')}</button>`;
    }
  }
  $('#layoutEditor').innerHTML = h + '</div>';
}

// 떼기 반경의 최댓값 = 좌석 배열에서 가장 먼 두 자리 사이의 거리(줄 차이·열 차이 중 큰 값). 최소 2
function maxSepDist() {
  const pts = [], D = dims();   // 통로(책상이 하나도 없는 줄·열)는 칸 수에서 뺀 번호로 계산
  for (let r = 0; r < state.layout.rows; r++) for (let c = 0; c < state.layout.cols; c++) if (!isOff(r, c)) pts.push([D.rowNo[r], D.colNo[c]]);
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
// 학급 이름 입력창 ↔ 상태 동기화 (입력 중일 때는 건드리지 않음)
function syncClassName() {
  const el = $('#className');
  if (document.activeElement !== el && el.value !== state.className) el.value = state.className;
}
function renderOptions() {
  enforceMix();
  const s = state.settings;
  refreshSepSelects();
  $('#optMode').value = s.mode; $('#optPairMode').value = s.pairMode;
  $('#optMix').checked = s.mix; $('#optAvoid').checked = s.avoidPrev; $('#optPast').checked = s.avoidPast; $('#optAnim').checked = s.animation;
  $('#className').value = state.className;
  $('#pastCount').textContent = `기록된 짝 ${state.pairHistory.length}쌍`;
  // 모둠 배치에서는 붙이기 방식·떼기 반경이 쓰이지 않으므로 숨기고, 추가 버튼을 학생 선택 줄로 올린다
  $$('.pair-grid').forEach(g => g.classList.toggle('gm', s.mode === 'group'));
  $('#modeHint').textContent = s.mode === 'group'
    ? '모둠 배치 방식에서는 다음과 같이 작동합니다.\n· 붙이기 = 같은 모둠\n· 떼기 = 다른 모둠\n· 이전 짝 = 같은 모둠이었던 학생'
    : '';
}

const pend = { fixed: null, range: null };
function studentOptions(sel, exclude) {
  const list = actives().filter(s => s.id !== exclude);
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

// 학생 선택 드롭다운 공통 너비: "99번 가나다라"(두 자리 번호 + 네 글자 이름)가 꽉 차게 들어가는 너비로 고정
// 실제 드롭다운 한 개를 화면 밖에서 만들어 브라우저가 계산한 자연 너비(글씨 + 여백 + 화살표)를 쓴다
function updateStudentSelectWidth() {
  const probe = document.createElement('select');
  probe.style.cssText = 'position:absolute;visibility:hidden;left:-9999px;top:0;width:auto;max-width:none';
  probe.innerHTML = '<option>99번 가나다라</option>';
  document.body.appendChild(probe);
  const px = Math.ceil(probe.getBoundingClientRect().width);
  probe.remove();
  document.documentElement.style.setProperty('--stu-w', px + 'px');
}
function renderConstraints() {
  refreshSepSelects(); updateStudentSelectWidth();
  fillPairSelects('pair'); fillPairSelects('sep');
  for (const id of ['fixS', 'rngS']) $('#' + id).innerHTML = studentOptions($('#' + id).value);

  const empty = t => `<li class="empty">${t}</li>`;
  $('#pairList').innerHTML = state.pairs.length ? state.pairs.map((p, i) =>
    `<li><span class="grow">${esc(label(byId(p.a)))} ↔ ${esc(label(byId(p.b)))}${state.settings.mode === 'group' ? '' : ' · ' + PAIR_LABEL[p.mode || state.settings.pairMode]}</span><button class="x" data-del="pairs:${i}">✕</button></li>`).join('') : empty('지정된 학생 없음');
  $('#sepList').innerHTML = state.seps.length ? state.seps.map((p, i) =>
    `<li><span class="grow">${esc(label(byId(p.a)))} ↔ ${esc(label(byId(p.b)))} · ${state.settings.mode === 'group' ? '다른 모둠' : '반경 ' + p.d + '칸 이상'}</span><button class="x" data-del="seps:${i}">✕</button></li>`).join('') : empty('지정된 학생 없음');
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
// mode 'range' : 여러 칸 선택(범위 제한) - 사각형으로 선택 / 한 칸씩 선택을 섞어 쓸 수 있음
const pk = { mode: 'cell', sel: null, set: new Set(), tool: 'rect', anchor: null, cb: null, base: '' };

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
  pk.mode = mode; pk.cb = cb; pk.anchor = null; pk.base = hint; pk.tool = 'rect';
  pk.sel = mode === 'cell' && initial ? { ...initial } : null;
  pk.set = mode === 'range' ? setFromEntry(initial) : new Set();
  $('#pickerTitle').textContent = title;
  $('#pickerReset').hidden = mode !== 'range';   // 초기화는 여러 칸을 고르는 범위 선택에서만 사용
  const q = $('#pickerQuick');
  q.innerHTML = '';
  if (mode === 'range') {
    const tools = document.createElement('div'); tools.className = 'seg left'; tools.id = 'pickerTools';
    [['rect', '사각형으로 선택'], ['cell', '한 칸씩 선택']].forEach(([k, t]) => {
      const b = document.createElement('button'); b.textContent = t; b.dataset.tool = k;
      b.onclick = () => { pk.tool = k; pk.anchor = null; drawPicker(); };
      tools.appendChild(b);
    });
    q.appendChild(tools);
  }
  drawPicker(); $('#picker').showModal();
}
function drawPicker() {
  const { rows, cols } = state.layout, D = dims(), range = pk.mode === 'range';
  const grid = $('#pickerGrid');
  grid.style.gridTemplateColumns = `repeat(${cols},auto)`;
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
/* ================= 검증 / 배치 알고리즘 ================= */
function validate() {
  const e = [], n = actives().length, seats = seatCount();
  if (n === 0) e.push('학생 명단이 비어 있어요.');
  if (n > seats) e.push(`학생(${n}명)이 좌석(${seats}개)보다 많아요. 좌석 배열을 늘려 주세요.`);
  if (state.settings.mode === 'group' && !Object.keys(state.layout.groups).some(k => { const [r, c] = k.split(',').map(Number); return !isOff(r, c); }))
    e.push('모둠 배치인데 만들어진 모둠이 없어요. 좌석 배열의 "모둠 편집 모드"에서 모둠을 만들어 주세요.');
  const taken = {};
  for (const f of state.fixed) {
    const s = byId(f.s); if (!s) continue;
    if (f.r >= state.layout.rows || f.c >= state.layout.cols || isOff(f.r, f.c)) e.push(`${label(s)}의 고정석(${seatText(f.r, f.c)})이 좌석이 아니에요.`);
    const k = f.r + ',' + f.c;
    if (taken[k]) e.push(`${josa(label(s), '과/와')} ${label(taken[k])}의 고정석이 같아요.`); else taken[k] = s;
  }
  const rs = {};
  for (const g of state.ranges) {
    let ok = false;
    for (let r = 0; r < state.layout.rows; r++) for (let c = 0; c < state.layout.cols; c++) if (!isOff(r, c) && rangeHas(g, r, c)) ok = true;
    (rs[g.s] ??= []).push(ok);
  }
  for (const [id, arr] of Object.entries(rs)) if (!arr.some(Boolean)) e.push(`${label(byId(+id))}의 범위 안에 좌석이 없어요.`);
  for (const p of state.pairs) if (state.seps.some(q => (q.a === p.a && q.b === p.b) || (q.a === p.b && q.b === p.a)))
    e.push(`${label(byId(p.a))}·${josa(label(byId(p.b)), '이/가')} 붙이기와 떼기에 모두 들어 있어요.`);
  return e;
}

function solve() {
  const S = actives(), n = S.length, gm = state.settings.mode === 'group', D = dims();
  const seats = [], seatIdx = {};
  for (let r = 0; r < state.layout.rows; r++) for (let c = 0; c < state.layout.cols; c++)
    if (!isOff(r, c)) { seatIdx[r + ',' + c] = seats.length; seats.push({ r, c, lr: D.rowNo[r], lc: D.colNo[c] }); }
  const sid = {}; S.forEach((s, i) => (sid[s.id] = i));
  // 거리 = 중심이 같은 정사각형 기준: 줄 차이와 열 차이 중 큰 값 (대각선도 피타고라스가 아닌 이 값)
  const dist = (a, b) => Math.max(Math.abs(a.lr - b.lr), Math.abs(a.lc - b.lc));   // 통로를 뺀 줄·열 번호 기준
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
    warnings.push(`이전에 짝이었던 ${label(S[i])} · ${josa(label(S[j]), '이/가')} 다시 ${gm ? '같은 모둠' : '짝'}이 되었어요.`);

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
function boardHTML(rec, { mini = false, edit = null } = {}) {
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
    const sw = edit ? `data-swap="${s.id}" role="button" tabindex="0"` : '', pre = edit && edit.pending === s.id ? 'swap-pre' : '';
    cells += `<div class="seat ${s.gender} ${gcls} ${pre}" ${gs} ${sw} data-sid="${s.id}" data-name="${esc(label(s))}" data-no="${esc(s.no)}">
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
  $('#optAnim').checked = state.settings.animation;
  $('#slotBar').innerHTML = state.slots.map((s, i) =>
    `<button class="slot ${s ? 'filled' : ''} ${i === state.activeSlot && !state.showAll ? 'active' : ''}" data-slot="${i}" ${state.showAll || editing ? 'disabled' : ''}>슬롯 ${i + 1}${s ? ' ♥' : ''}</button>`).join('');
  const errs = validate(), pb = $('#problems');
  pb.hidden = !errs.length; pb.classList.toggle('bad', !!errs.length);
  // 배치할 수 없는 상태(학생 수 > 좌석 수 등)에서는 배치 버튼을 막는다. 사유는 위 안내 상자에 표시됨
  const blocked = errs.length > 0;
  const setDis = (act, v, tip) => { const b = $(`.toolbar [data-act="${act}"]`); if (b) { b.disabled = v; b.title = v && tip ? tip : ''; } };
  const editTip = '편집 중에는 사용할 수 없어요. 편집 완료를 먼저 눌러 주세요';
  setDis('shuffle', blocked || state.showAll || !!editing, editing ? editTip : blocked ? '위 안내를 먼저 해결해 주세요' : '"한 번에 보기"에서는 각 슬롯의 버튼을 사용하세요');
  setDis('fill-all', blocked || !!editing, editing ? editTip : '위 안내를 먼저 해결해 주세요');
  setDis('clear-slot', state.showAll || !!editing, editing ? editTip : '"한 번에 보기"에서는 각 슬롯의 버튼을 사용하세요');
  setDis('confirm-slot', state.showAll || !!editing, editing ? editTip : '"한 번에 보기"에서는 각 슬롯의 버튼을 사용하세요');
  $('#showAll').disabled = !!editing;
  $('#editCancelBtn').hidden = !editing;
  const eb = $('#editSlotBtn');
  eb.textContent = editing ? '편집 완료' : '편집'; eb.classList.toggle('primary', !!editing);
  eb.disabled = !editing && (state.showAll || !state.slots[state.activeSlot]);
  eb.title = eb.disabled ? (state.showAll ? '"한 번에 보기"에서는 사용할 수 없어요' : '편집할 자리가 없어요') : '';
  pb.innerHTML = errs.length ? `<b>배치 전에 확인해 주세요</b><ul>${errs.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
  const area = $('#shuffleArea');
  const modeTxt = s => (s.mode === 'group' ? ' · 모둠 배치' : '');
  if (state.showAll) {
    area.innerHTML = '<div class="all-grid">' + state.slots.map((s, i) => `
      <div class="slot-card" id="slotcard-${i}">
        <header><b>슬롯 ${i + 1}</b>
          <button class="btn small" data-act="shuffle" data-i="${i}" ${blocked ? 'disabled' : ''}>${s ? '다시 배치' : '배치'}</button>
          <button class="btn small good" data-act="confirm-slot" data-i="${i}" ${s ? '' : 'disabled'}>확정</button>
          <button class="btn small" data-act="clear-slot" data-i="${i}" ${s ? '' : 'disabled'}>비우기</button></header>
        ${s ? boardHTML(s, { mini: true }) + warnHTML(s.warnings) : '<div class="empty-board">비어 있음</div>'}
      </div>`).join('') + '</div>';
  } else {
    const s = state.slots[state.activeSlot];
    const ed = editing && editing.slot === state.activeSlot ? editing : null;
    area.innerHTML = s
      ? `<div id="slotcard-${state.activeSlot}">${ed ? '<p class="edit-hint">자리를 바꿀 학생을 차례로 눌러 주세요. 두 학생의 자리가 서로 바뀌어요.</p>' : ''}${ed ? boardHTML({ ...s, seats: ed.draft }, { edit: { pending: ed.pending } }) : boardHTML(s)}<p class="meta">슬롯 ${state.activeSlot + 1} · ${fmtTime(s.at)} 배치${modeTxt(s)}${s.edited ? ' · 편집됨' : ''}</p>${ed ? '' : warnHTML(s.warnings)}</div>`
      : `<div class="empty-board">${josa('슬롯 ' + (state.activeSlot + 1), '은/는')} 비어 있어요.<br>위의 <b>자리 배치!</b> 버튼을 눌러 보세요.</div>`;
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
    const total = 2600, t0 = performance.now(), names = actives().map(label);
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
  if (state.settings.keepHistory && state.final) pushHistory(state.final);   // 이전 확정 자리를 이력으로 보관
  state.final = { seats: s.seats, warnings: s.warnings, at: Date.now(), mode: s.mode, snap: snapshotNow() };
  state.slots = Array(SLOT_N).fill(null); state.activeSlot = 0;
  save(); showTab('final'); toast(`최종 자리가 저장되었어요. (짝 기록 +${add.length}쌍)`);
}

/* ================= ③ 확정된 자리 ================= */
function renderFinal() {
  syncViewSeg();
  const f = state.final, area = $('#finalArea');
  if (!f) { area.innerHTML = '<div class="empty-board">아직 확정된 자리가 없어요.<br>② 자리 배치에서 마음에 드는 슬롯을 확정해 주세요.</div>'; renderHistory(); return; }
  area.innerHTML = `<div class="print-title">${esc(state.className || '우리반')} 자리 배치표</div>${boardHTML(f)}
    <p class="meta">${esc(state.className || '')} · ${fmtTime(f.at)} 확정${f.mode === 'group' ? ' · 모둠 배치' : ''} · ${state.view === 'teacher' ? '교사용(교탁에서 본 시점)' : '학생용(교탁을 바라보는 시점)'}</p>${warnHTML(f.warnings)}`;
  renderHistory();
}

/* ================= 확정 이력 ================= */
const clone = o => JSON.parse(JSON.stringify(o));
// 확정 시점의 명단·좌석 배열·고정석을 복사해 둔다 (나중에 명단이 바뀌어도 이력 화면이 그때 모습 그대로 보이도록)
const snapshotNow = () => ({ students: clone(state.students), layout: clone(state.layout), fixed: clone(state.fixed) });
function withSnapshot(snap, fn) {   // 보드 그리기 함수가 state를 읽으므로, 잠깐 이력 시점의 값으로 바꿔서 그린다
  const keep = { students: state.students, layout: state.layout, fixed: state.fixed };
  state.students = snap.students; state.layout = snap.layout; state.fixed = snap.fixed || [];
  try { return fn(); } finally { Object.assign(state, keep); }
}
function pushHistory(f) {
  state.history.unshift({
    hid: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    at: f.at, seats: f.seats, mode: f.mode, warnings: f.warnings || [], snap: f.snap || snapshotNow(), note: '',
  });
  state.history = state.history.slice(0, state.settings.historyMax);   // 최근 N개만 보관
}
const histById = hid => state.history.find(h => h.hid === hid);
function renderHistory() {
  const st = state.settings;
  $('#optHistory').checked = st.keepHistory; $('#histMax').value = String(st.historyMax);
  $('#historyClear').hidden = !state.history.length;
  $('#historyList').innerHTML = state.history.length
    ? state.history.map(h => `<li><span class="hist-date">${fmtTime(h.at)}${h.mode === 'group' ? ' · 모둠' : ''}</span>
        <input type="text" class="hist-note" data-hid="${h.hid}" value="${esc(h.note)}" placeholder="메모" maxlength="30">
        <button class="btn small" data-act="history-view" data-hid="${h.hid}">보기</button>
        <button class="x" data-act="history-del" data-hid="${h.hid}" title="삭제">✕</button></li>`).join('')
    : `<li class="empty">${st.keepHistory ? '아직 보관된 이력이 없어요. 새로 확정하면 이전 확정 자리가 여기에 쌓여요.' : '이력 보관이 꺼져 있어요.'}</li>`;
}
function openHistoryView(h) {
  $('#historyViewTitle').textContent = `확정 이력 — ${fmtTime(h.at)}${h.mode === 'group' ? ' · 모둠 배치' : ''}`;
  $('#historyViewBody').innerHTML = withSnapshot(h.snap, () => boardHTML(h)) +
    `<p class="meta">${h.note ? esc(h.note) + ' · ' : ''}${state.view === 'teacher' ? '교사용(교탁에서 본 시점)' : '학생용(교탁을 바라보는 시점)'}</p>`;
  $('#historyView').showModal();
}

/* ================= 탭 ================= */
const TAB_KEY = 'seat-changer-tab';   // 새로고침 후에도 보던 탭을 유지 (저장 파일에는 넣지 않는 화면 설정)
function showTab(name) {
  try { localStorage.setItem(TAB_KEY, name); } catch (e) { /* ignore */ }
  syncClassName();   // 상단 학급 이름 입력창은 어느 탭에서든 저장된 값과 같게 맞춘다
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
function renderAllCurrent() { editing = null; showTab(currentTab() || 'setup'); }

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
    ['[학생명단] 번호(자동 연번) / 이름 / 성별(남·여). 번호 칸은 비워도 되고, 위에서부터 1, 2, 3… 순서로 매겨집니다. 없는 번호(결번)는 이름 칸에 \"결번\"이라고 적으세요.'],
    ['[좌석배열] 위쪽 행이 교탁에 가까운 앞쪽 행, 왼쪽이 학생이 앉아서 본 왼쪽. 책상 있는 칸 = 1, 빈 칸·통로 = 0'],
    ['[모둠] 좌석배열과 같은 크기의 표에 모둠 번호를 적습니다 (모둠 배치를 쓸 때만, 없는 칸은 0)'],
    ['[붙이기] 붙여 앉힐 두 학생 (번호 또는 이름)과 방식(좌우/주변, 비우면 설정 시트의 붙이기방식). 모둠 배치에서는 같은 모둠'],
    ['[떼기] 떼어 앉힐 두 학생과 최소 반경(칸). 비우면 2칸. 반경 = 행 차이와 열 차이 중 큰 값. 모둠 배치에서는 다른 모둠'],
    ['[고정석] 학생 / 행 / 열 — 통로(책상이 하나도 없는 행·열)를 뺀 번호. 행 1 = 맨 앞 행, 열 1 = 맨 왼쪽'],
    ['[범위] 학생 / 시작행 / 끝행 / 시작열 / 끝열 (같은 학생을 여러 줄 적으면 합쳐서 적용)'],
    ['[이전짝] 예전에 짝(또는 같은 모둠)이었던 두 학생. 앱에서 확정할 때마다 자동으로 쌓입니다.'],
    ['[설정] 배치방식(일반/모둠), 붙이기방식(좌우/주변), 남녀섞기, 이전자리피하기, 이전짝피하기(O/X)'],
  ], [110]);
  add('학생명단', [['번호', '이름', '성별'], ...src.students.map((s, i) => [i + 1, s.vacant ? '결번' : s.name, s.vacant ? '' : s.gender === 'M' ? '남' : s.gender === 'F' ? '여' : ''])], [8, 16, 8]);
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
          const nm0 = String(r[1]).trim(), vac = nm0 === '결번';   // 이름 칸에 '결번'이라고 적힌 번호는 없는 학생
          next.students.push({ id: next.nextId++, no: i + 1, name: vac ? '' : nm0, gender: vac ? '' : parseGender(r[2]), vacant: vac, _orig: Number.isFinite(o) ? o : i + 1 });
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
        if (/^\d+$/.test(t)) { const s = next.students.find(x => x._orig === +t && !x.vacant); if (s) return s; }
        return next.students.find(x => x.name === t && !x.vacant) || null;
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
        if (s && next.fixed.some(f => f.s === s.id)) return warn.push(`범위 ${i + 2}행: ${josa(s.name, '은/는')} 고정석이 있어 범위를 지정할 수 없어요`);
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
      if (warn.length) await notify(`엑셀을 불러왔어요. (학생 ${actives().length}명, 좌석 ${seatCount()}개)\n\n확인이 필요한 항목:\n` + warn.slice(0, 8).join('\n') + (warn.length > 8 ? `\n…외 ${warn.length - 8}건` : ''), '불러왔어요');
      else toast(`엑셀을 불러왔어요. (학생 ${actives().length}명, 좌석 ${seatCount()}개)`);
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

/* ================= 도움말 모달 (오른쪽 위 X 또는 Esc로 닫힘) ================= */
function openHelp(title, html) {
  $('#helpTitle').textContent = title; $('#helpBody').innerHTML = html;
  $('#helpModal').showModal();
}

/* ================= 이벤트 ================= */
document.addEventListener('click', async e => {
  const t = e.target.closest('button, [data-goto], .tab-x'); if (!t) return;

  if (editing && (t.dataset.tab || t.dataset.goto)) { await notify('자리를 편집하는 중이에요.\n편집 완료를 누른 뒤 이동해 주세요.'); return; }
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
    else if (pk.tool === 'cell') { const k = r + ',' + c; if (pk.set.has(k)) pk.set.delete(k); else pk.set.add(k); }
    else if (!pk.anchor) pk.anchor = { r, c };
    else { addRect(pk.anchor.r, pk.anchor.c, r, c); pk.anchor = null; }
    drawPicker(); return;
  }

  const act = t.dataset.act; if (!act) return;
  const idx = t.dataset.i != null ? +t.dataset.i : state.activeSlot;
  if (busy && act !== 'picker-cancel') return;
  switch (act) {
    case 'layout-help': openHelp('좌석 배열 — 사용 방법', `
      <ul>
        <li>칸을 누르면 <b>책상 있음/없음(빈칸)</b>이 바뀌어요.</li>
        <li>행·열 머리글을 누르면 그 행·열 전체가 한 번에 바뀌어요.</li>
        <li>책상이 하나도 없는 행·열은 <b>통로</b>로 표시되고 번호에서 빠져요.</li>
      </ul>`); break;
    case 'range-help': openHelp('범위 제한 학생 — 사용 방법', `
      <p>범위를 정한 학생은 <b>지정한 구역 안에서만</b> 섞여요.<br>(예: 시력 때문에 앞 두 행)</p>
      <ul>
        <li><b>구역 선택</b> 버튼으로 구역을 정해요.</li>
        <li>같은 학생에게 구역을 여러 번 추가하면 모두 합쳐서 적용돼요.</li>
        <li>고정석이 있는 학생은 범위를 지정할 수 없어요.</li>
      </ul>`); break;
    case 'sep-help': openHelp('떼어 앉힐 학생 — 반경이란?', `
      <p>반경은 한 학생의 자리를 <b>중심으로 한 정사각형 범위</b>로 잽니다. 두 자리의 행 차이와 열 차이 중 <b>큰 값</b>이 반경 이상이어야 떼어 앉힌 것으로 봐요.</p>
      <ul>
        <li><b>반경 2칸</b> : 바로 옆·앞뒤·대각선에는 앉을 수 없고, 한 칸 건너 앉는 것은 가능해요.</li>
        <li><b>반경 3칸</b> : 두 칸 이상 떨어져야 해요.</li>
        <li>선택할 수 있는 최댓값은 좌석 배열에 맞춰 자동으로 정해져요.</li>
        <li>통로(책상이 하나도 없는 행·열)는 칸 수에 넣지 않아요.</li>
        <li>모둠 배치에서는 반경 대신 <b>"다른 모둠"</b>이면 떼어 앉힌 것으로 봐요.</li>
      </ul>`); break;
    case 'help-close': $('#helpModal').close(); break;
    case 'hist-close': $('#historyView').close(); break;
    case 'history-view': { const h = histById(t.dataset.hid); if (h) openHistoryView(h); break; }
    case 'history-del':
      if (await ask('이 확정 이력을 삭제할까요?' + '\n' + '(되돌릴 수 없어요)', { title: '이력 삭제', ok: '삭제', danger: true })) { state.history = state.history.filter(x => x.hid !== t.dataset.hid); save(); renderHistory(); }
      break;
    case 'history-clear':
      if (state.history.length && await ask(`보관된 이력 ${state.history.length}개를 모두 삭제할까요?\n(되돌릴 수 없어요)`, { title: '이력 모두 삭제', ok: '모두 삭제', danger: true })) { state.history = []; save(); renderHistory(); }
      break;
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
    case 'bulk-open': setBulk(true); $('#bulkText').focus(); break;
    case 'bulk-close': setBulk(false); break;
    case 'bulk-apply': {
      const lines = $('#bulkText').value.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      if (!lines.length) break;
      const entries = lines.map(l => {
        let p = l.split(/[\t,]+|\s+/).filter(Boolean);
        if (p.length >= 2 && /^\d+$/.test(p[0])) p = p.slice(1);   // 앞의 번호는 무시(자동 연번)
        return p[0] === '결번' ? { name: '', gender: '', vacant: true }   // "결번"이라고 적은 줄은 없는 번호
          : { name: p[0], gender: parseGender(p[1]), vacant: false };
      });
      const vacantAdded = entries.filter(x => x.vacant).length, realAdded = entries.length - vacantAdded;
      // 이미 명단이 있으면 새 명단을 맨 앞/맨 뒤 중 어디에 넣을지 묻는다 (맨 앞이면 기존 번호가 뒤로 밀림)
      let where = 'back';
      if (state.students.length) {
        const hasVacant = state.students.some(x => x.vacant);
        where = await modal('이미 명단이 있어요',
          `명단에 이미 ${hasVacant ? `학생 ${actives().length}명과 결번 ${state.students.length - actives().length}개가` : `학생 ${state.students.length}명이`} 있어요.\n붙여넣은 ${vacantAdded ? `학생 ${realAdded}명과 결번 ${vacantAdded}개를` : `${realAdded}명을`} 어디에 넣을까요?\n(맨 앞에 넣으면 기존 명단의 번호가 뒤로 밀려요.)`,
          [{ t: '취소', v: 'cancel', esc: true, cls: 'small' }, { t: '맨 앞에 넣기', v: 'front', cls: 'small' }, { t: '맨 뒤에 넣기', v: 'back', cls: 'small primary' }]);
        if (where === 'cancel' || !where) break;   // 취소하면 입력한 내용을 그대로 두고 입력창도 열어 둔다
      }
      if (!await guard()) break;
      const created = entries.map(x => ({ id: state.nextId++, no: 0, name: x.name, gender: x.gender, ...(x.vacant ? { vacant: true } : {}) }));
      if (where === 'front') state.students.unshift(...created); else state.students.push(...created);
      renumber(state);
      $('#bulkText').value = ''; setBulk(false);
      save(); renderStudents(); renderConstraints();
      toast(`${realAdded}명을 ${state.students.length > created.length ? (where === 'front' ? '맨 앞에 ' : '맨 뒤에 ') : ''}추가했어요.` + (vacantAdded ? ` (결번 ${vacantAdded}개)` : ''));
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
      const had = state.ranges.filter(g => g.s === s).length;
      if (had && !await ask(`${label(byId(s))}에게는 범위 제한이 ${had}개 있어요.
고정석을 지정하면 범위 제한은 삭제됩니다.
계속할까요?`, { title: '범위 제한이 삭제돼요', ok: '고정석 지정', danger: true })) break;
      state.ranges = state.ranges.filter(g => g.s !== s);
      state.fixed = state.fixed.filter(f => f.s !== s); state.fixed.push({ s, ...pend.fixed });
      pend.fixed = null; save(); renderConstraints(); break;
    }
    case 'pick-range':
      if (!seatCount()) { await notify('먼저 좌석을 만들어 주세요.'); break; }
      openPicker({ title: '범위 선택', hint: '사각형: 두 모서리를 차례로 누르면 그 안의 칸이 추가돼요. 한 칸씩: 칸을 누르면 선택되고, 다시 누르면 해제돼요.', mode: 'range', initial: pend.range, cb: v => { pend.range = v; renderConstraints(); } }); break;
    case 'add-range': {
      const s = +$('#rngS').value;
      if (!s || !pend.range) { await notify('학생과 구역을 선택해 주세요.'); break; }
      if (state.fixed.some(f => f.s === s)) { await notify(`${josa(label(byId(s)), '은/는')} 고정석이 있어서 범위를 지정할 수 없어요.`); break; }
      state.ranges.push({ s, ...pend.range }); pend.range = null; save(); renderConstraints(); break;
    }
    case 'picker-reset': pk.set.clear(); pk.anchor = null; drawPicker(); break;
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
    case 'edit-cancel':   // 편집 취소: 바꾼 내용을 버리고 슬롯은 그대로 둔다
      if (!editing) break;
      if (editing.changed && !await ask('편집한 내용을 모두 버릴까요?' + '\n' + '(슬롯은 편집 전 상태로 남아요)', { title: '편집 취소', ok: '버리기', danger: true })) break;
      editing = null; renderShuffle(); break;
    case 'edit-slot': {
      if (editing) {   // 편집 완료: 바뀐 내용을 슬롯에 반영 (규칙 위반 경고는 따로 띄우지 않음)
        const slot = state.slots[editing.slot];
        if (slot && editing.changed) { slot.seats = editing.draft; slot.warnings = []; slot.edited = true; save(); }
        editing = null; renderShuffle(); break;
      }
      const slot = state.slots[state.activeSlot];
      if (!slot || state.showAll) break;
      editing = { slot: state.activeSlot, draft: Object.fromEntries(Object.entries(slot.seats).map(([k, v]) => [k, [...v]])), pending: null, changed: false };
      renderShuffle(); break;
    }
    case 'print': window.print(); break;
    case 'export-final': exportFinalXlsx(); break;
    case 'drop-final':
      if (state.final && await ask('확정된 자리를 삭제할까요?\n(되돌릴 수 없어요. 쌓인 짝 기록은 그대로 남아요)', { ok: '삭제', danger: true })) { state.final = null; save(); renderFinal(); } break;
  }
});

// ✕(탭 닫기 표시)는 키보드로도 누를 수 있게
document.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('tab-x')) { e.preventDefault(); e.target.click(); }
});

// 자리 편집: 바꿀 학생을 하나 누르면 그 칸의 점선이 깜빡이고, 다른 학생을 누르면 두 학생의 자리가 서로 바뀐다
function swapClick(id) {
  const ed = editing; if (!ed) return;
  if (ed.pending === null) ed.pending = id;
  else if (ed.pending === id) ed.pending = null;   // 같은 학생을 다시 누르면 선택 해제
  else { const d = ed.draft, a = d[ed.pending], b = d[id]; d[ed.pending] = b; d[id] = a; ed.pending = null; ed.changed = true; }
  renderShuffle();
}
document.addEventListener('click', e => { const el = e.target.closest && e.target.closest('.seat[data-swap]'); if (el && editing) swapClick(+el.dataset.swap); });
document.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('.seat[data-swap]') && editing) { e.preventDefault(); swapClick(+e.target.dataset.swap); }
});

// 입력 변경
document.addEventListener('change', async e => {
  const t = e.target;
  if (t.matches('#studentTable [data-f]')) {
    const s = state.students[+t.dataset.i], f = t.dataset.f; if (!s) return;
    if (f === 'vacant') {
      const on = t.checked;
      const has = state.pairs.some(p => p.a === s.id || p.b === s.id) + state.seps.some(p => p.a === s.id || p.b === s.id) + state.fixed.some(p => p.s === s.id) + state.ranges.some(p => p.s === s.id);
      if (on && has && !await ask(`${s.no}번을 결번으로 하면 이 번호에 지정된 붙이기·떼기·고정석·범위 설정이 삭제돼요.\n계속할까요?`, { title: '설정이 삭제돼요', ok: '결번으로 체크', danger: true })) { t.checked = false; return; }
      if (!await guard()) { t.checked = !on; return; }
      s.vacant = on;
      if (on) {
        state.pairs = state.pairs.filter(p => p.a !== s.id && p.b !== s.id); state.seps = state.seps.filter(p => p.a !== s.id && p.b !== s.id);
        state.fixed = state.fixed.filter(p => p.s !== s.id); state.ranges = state.ranges.filter(p => p.s !== s.id);
      }
      save(); renderStudents(); renderConstraints(); renderOptions();
      return;
    }
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
    // 모둠 → 일반 자리: 모둠 기준(같은 모둠/다른 모둠)으로 만든 붙이기·떼기는 의미가 달라지므로 초기화
    if (t.value === 'seat' && state.settings.mode === 'group' && (state.pairs.length || state.seps.length)) {
      const ok = await ask(`일반 자리 모드로 돌아가면 붙여 앉힐 학생(${state.pairs.length}쌍)과 떼어 앉힐 학생(${state.seps.length}쌍)에 설정한 내용이 초기화됩니다.
계속할까요?`,
        { title: '설정이 초기화돼요', ok: '초기화하고 변경', danger: true });
      if (!ok) { t.value = 'group'; return; }
      state.pairs = []; state.seps = [];
      renderConstraints();
    }
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
  else if (t.id === 'optHistory') { state.settings.keepHistory = t.checked; save(); renderHistory(); }
  else if (t.id === 'histMax') {
    const n = +t.value;
    if (state.history.length > n && !await ask(`최근 ${n}개만 보관하면 오래된 이력 ${state.history.length - n}개가 삭제돼요.\n계속할까요?`, { title: '오래된 이력이 삭제돼요', ok: '계속', danger: true })) { t.value = String(state.settings.historyMax); return; }
    state.settings.historyMax = n; state.history = state.history.slice(0, n); save(); renderHistory();
  }
  else if (t.classList.contains('hist-note')) { const h = histById(t.dataset.hid); if (h) { h.note = t.value.trim(); save(); } }
  else if (t.id === 'showAll') { state.showAll = t.checked; save(); renderShuffle(); }
  else if (t.id === 'fileJson') { if (t.files[0]) loadJson(t.files[0]); t.value = ''; }
  else if (t.id === 'fileXlsx') { if (t.files[0]) importXlsx(t.files[0]); t.value = ''; }
});
$('#className').addEventListener('input', e => { state.className = e.target.value; save(); if (currentTab() === 'final') renderFinal(); });   // 확정된 자리 화면의 제목도 바로 따라가게

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
let startTab = null;
try { startTab = localStorage.getItem(TAB_KEY); } catch (e) { /* ignore */ }
if (!['setup', 'shuffle', 'final'].includes(startTab))   // 처음 접속: 작업 상태에 맞춰 시작 탭 결정
  startTab = state.final && !state.slots.some(Boolean) && state.students.length ? 'final' : state.students.length ? 'shuffle' : 'setup';
showTab(startTab);
