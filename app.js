import * as db from './db.js';
import {
  BOARDS, BOARD_ORDER, layout, makeState, countPegs, movesFrom, allMoves, hasMoves,
  applyMove, startKey, isClassicStart, scoreGame,
} from './game.js';
import { ACHIEVEMENTS } from './achievements.js';
import { PUZZLES, puzzleState, goalCell, goalMet, goalText } from './puzzles.js';

const VERSION = '1.11.0';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

// ---------------------------------------------------------------- état global
const DEFAULT_SETTINGS = { haptics: true, hints: false, light: false, classicBoard: 'english', v: 2 };
const DEFAULT_STATS = {
  played: 0, wins: 0, points: 0, time: 0, removed: 0, customPlayed: 0,
  boards: {}, days: [], hist: {}, best: {}, // best[key] = { left, time, date, board, pegs }
};

let settings = { ...DEFAULT_SETTINGS };
let stats = structuredClone(DEFAULT_STATS);
let unlocked = {}; // id -> date
let solved = {};   // casse-tête id -> { date, time, moves, undos }
let game = null;   // partie en cours
let setup = { board: 'english', state: null };
let busy = false;

// ---------------------------------------------------------------- utilitaires
const fmtTime = ms => {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
};
const fmtNum = n => n.toLocaleString('fr-FR');
const today = () => new Date().toISOString().slice(0, 10);
const plural = (n, w) => `${w}${n > 1 ? 's' : ''}`;
// Retour haptique.
// Android : navigator.vibrate().
// iPhone : Safari n'expose pas le vibreur et ne vibre que quand le doigt touche
// réellement un <input switch> natif. On pose donc un interrupteur natif invisible
// par-dessus chaque plateau : le toucher le bascule (→ vibration du système) et
// on annule la bascule quand ce toucher ne doit pas vibrer.
const canVibrate = typeof navigator.vibrate === 'function';
let hapticWanted = false;
function buzz(p) {
  if (!settings.haptics) return;
  if (canVibrate) { try { navigator.vibrate(Array.isArray(p) ? p : Math.max(p, 30)); } catch {} }
  else hapticWanted = true;
}
function toast(msg) {
  const t = $('#toast');
  t.hidden = true; void t.offsetWidth;
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2600);
}

// ---------------------------------------------------------------- navigation
let current = 'home';
function go(name) {
  if (current === 'game' && name !== 'game') pauseTimer();
  $$('.screen').forEach(s => s.toggleAttribute('data-active', s.id === 'screen-' + name));
  current = name;
  if (name === 'home') renderHome();
  if (name === 'stats') renderStats();
  if (name === 'achievements') renderAchievements();
  if (name === 'settings') renderSettings();
  if (name === 'setup') renderSetup();
  if (name === 'puzzles') renderPuzzles();
  if (name === 'game') resumeTimer();
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-go]');
  if (b) go(b.dataset.go);
});

// ---------------------------------------------------------------- rendu du plateau
function buildBoard(el, boardId, onCell) {
  const L = layout(boardId);
  el.style.setProperty('--n', L.n);
  el.classList.toggle('tri', !!L.tri);
  el.innerHTML = '';
  const cells = [];
  L.cells.forEach((valid, i) => {
    const c = document.createElement('div');
    c.className = 'cell' + (valid ? '' : ' void');
    c.dataset.i = i;
    const p = L.pos[i];
    c.style.left = (p.x / L.n) * 100 + '%';
    c.style.top = (p.y / L.n) * 100 + '%';
    if (valid) {
      const peg = document.createElement('span');
      peg.className = 'peg';
      c.appendChild(peg);
      el.appendChild(c);
    }
    cells[i] = c;
  });
  el._cells = cells;
  el._layout = L;
  el._onTap = onCell || null;
  bindInput(el);
}

function paintBoard(el, state, { selected = null, targets = [], overs = [], movable = null } = {}) {
  const tset = new Set(targets), oset = new Set(overs);
  el._cells.forEach((c, i) => {
    const v = state[i];
    if (v === null || !c) return;
    const peg = c.firstChild;
    peg.style.display = v === 1 ? '' : 'none';
    peg.classList.remove('gone');
    peg.style.transform = '';
    c.classList.toggle('selected', i === selected);
    c.classList.toggle('target', tset.has(i));
    c.classList.toggle('over', oset.has(i));
    c.classList.toggle('movable', !!movable && movable.has(i) && i !== selected);
  });
}

// ---------------------------------------------------------------- partie
function newGame(boardId, start, custom, puzzleId = null) {
  game = {
    board: boardId,
    start: start.slice(),
    state: start.slice(),
    history: [],
    moves: 0, undos: 0,
    elapsed: 0, t0: null,
    chain: 0, maxChain: 0, lastTo: null,
    custom: !!custom && !puzzleId,
    puzzle: puzzleId,
    key: (puzzleId ? 'puzzle:' : '') + startKey(boardId, start),
    classic: isClassicStart(boardId, start),
    selected: null,
  };
  $('#sheet-end').hidden = true;
  buildBoard($('#board'), boardId, onGameCell);
  go('game');
  renderGame();
  saveCurrent();
}

function startClassic() {
  const b = settings.classicBoard;
  newGame(b, makeState(b), false);
}

function renderGame() {
  if (!game) return;
  const L = layout(game.board);
  const left = countPegs(game.state);
  $('#game-left').textContent = left;
  $('#game-left').nextElementSibling.textContent = plural(left, 'bille');
  $('#game-moves').textContent = game.moves;
  const best = stats.best[game.key];
  $('#game-best').textContent = best ? best.left : '—';
  const pz = currentPuzzle();
  $('#game-title').textContent = pz ? `Casse-tête · ${pz.name}` : game.classic ? `Classique · ${BOARDS[game.board].name}` : `Libre · ${BOARDS[game.board].name}`;
  $('#game-goal').hidden = !pz;
  if (pz) $('#game-goal').innerHTML = `<span class="label">Objectif</span> ${goalText(pz)}${solved[pz.id] ? ' <b>· résolu</b>' : ''}`;
  const gc = pz ? goalCell(pz) : -1;
  $('#board')._cells.forEach((c, i) => c && c.classList.toggle('goal', i === gc));
  $('#btn-undo').disabled = game.history.length === 0;
  const sel = game.selected != null ? movesFrom(game.state, L.n, game.selected, L.dirs) : [];
  const targets = sel.map(m => m.to), overs = sel.map(m => m.over);
  let movable = null;
  if (settings.hints) movable = new Set(allMoves(game.state, L.n, L.dirs).map(m => m.from));
  paintBoard($('#board'), game.state, { selected: game.selected, targets, overs, movable });
  $('#board').classList.toggle('has-sel', game.selected != null);
}

function onGameCell(i) {
  if (busy || !game) return;
  const L = layout(game.board);
  if (game.selected != null) {
    const m = movesFrom(game.state, L.n, game.selected, L.dirs).find(m => m.to === i);
    if (m) return doMove(m);
  }
  if (game.state[i] === 1) {
    const ms = movesFrom(game.state, L.n, i, L.dirs);
    if (ms.length === 0) { game.selected = null; renderGame(); flashNo(i); return; }
    game.selected = game.selected === i ? null : i;
  } else {
    game.selected = null;
  }
  renderGame();
}

function flashNo(i) {
  const peg = $('#board')._cells[i].firstChild;
  peg.classList.remove('shake'); void peg.offsetWidth; peg.classList.add('shake');
  setTimeout(() => peg.classList.remove('shake'), 220);
}

async function doMove(m) {
  busy = true;
  const el = $('#board');
  const from = el._cells[m.from], to = el._cells[m.to], over = el._cells[m.over];
  const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
  const peg = from.firstChild;
  el.classList.remove('has-sel');
  $$('.cell.selected, .cell.over', el).forEach(c => c.classList.remove('selected', 'over'));
  peg.style.transform = `translate(${b.left - a.left}px, ${b.top - a.top}px)`;
  over.firstChild.classList.add('gone');
  $$('.cell.target', el).forEach(c => c.classList.remove('target'));
  buzz(40);
  if (game.t0 == null) resumeTimer();

  await new Promise(r => setTimeout(r, 120));

  game.history.push({ state: game.state, chain: game.chain, lastTo: game.lastTo, maxChain: game.maxChain });
  game.state = applyMove(game.state, m);
  game.moves++;
  game.chain = game.lastTo === m.from ? game.chain + 1 : 1;
  game.maxChain = Math.max(game.maxChain, game.chain);
  game.lastTo = m.to;

  // garder la bille sélectionnée si elle peut encore sauter (enchaînements)
  const L = layout(game.board);
  game.selected = null;
  peg.style.transition = 'none';
  renderGame();
  void peg.offsetWidth; peg.style.transition = '';
  to.firstChild.classList.remove('pop'); void to.offsetWidth; to.firstChild.classList.add('pop');
  setTimeout(() => to.firstChild.classList.remove('pop'), 240);
  busy = false;

  if (!hasMoves(game.state, L.n, L.dirs)) {
    await finishGame();
  } else {
    saveCurrent();
  }
}

function undo() {
  if (!game || !game.history.length || busy) return;
  const h = game.history.pop();
  game.state = h.state; game.chain = h.chain; game.lastTo = h.lastTo; game.maxChain = h.maxChain;
  game.moves--; game.undos++; game.selected = null;
  buzz(10);
  renderGame();
  saveCurrent();
}

function restart() {
  if (!game) return;
  newGame(game.board, game.start, game.custom, game.puzzle);
}

function startPuzzle(id) {
  const p = PUZZLES.find(p => p.id === id);
  if (p) newGame(p.board, puzzleState(p), false, p.id);
}
const currentPuzzle = () => (game && game.puzzle ? PUZZLES.find(p => p.id === game.puzzle) : null);

// --- entrée tactile : grande zone de toucher + glisser pour sauter
// Toute la zone autour du plateau est sensible ; on vise le trou le plus proche,
// avec priorité aux destinations possibles quand une bille est sélectionnée.
function pickCell(el, x, y, maxDist = 0.9) {
  const L = el._layout; if (!L) return null;
  const r = el.getBoundingClientRect();
  const u = ((x - r.left) / r.width) * L.n, v = ((y - r.top) / r.height) * L.n;
  const near = idxs => {
    let best = null, bd = Infinity;
    for (const i of idxs) {
      const p = L.pos[i]; const d = Math.hypot(p.x + 0.5 - u, p.y + 0.5 - v);
      if (d < bd) { bd = d; best = i; }
    }
    return { i: best, d: bd };
  };
  const all = near(L.cells.map((v, i) => (v ? i : -1)).filter(i => i >= 0));
  if (el.id === 'board' && game && game.selected != null) {
    const t = near(movesFrom(game.state, L.n, game.selected, L.dirs).map(m => m.to));
    // on vise une destination si on est proche, sauf si on touche franchement une autre bille
    const onPeg = all.i != null && all.d <= 0.4 && game.state[all.i] === 1;
    if (t.i != null && t.d <= 1.05 && !onPeg) return t.i;
  }
  return all.d <= maxDist ? all.i : null;
}

function bindInput(el) {
  const wrap = el.parentElement;
  if (wrap._bound) return;
  wrap._bound = true;

  const doTap = s0 => {
    if (s0.i != null && el._onTap) el._onTap(s0.i);
    else if (el.id === 'board' && game && game.selected != null) { game.selected = null; renderGame(); }
  };

  // iPhone : un <label> plein cadre contenant un interrupteur natif. Le toucher est
  // traité DANS le clic du label (pas avant) : si le coup doit vibrer, on laisse
  // l'interrupteur basculer (→ vibration système), sinon on annule la bascule.
  // Traiter le coup avant le clic modifierait l'écran et Safari annulerait le clic.
  let hap = null, pending = null;
  if (!canVibrate) {
    hap = document.createElement('label');
    hap.className = 'hap';
    hap.setAttribute('aria-hidden', 'true');
    const sw = document.createElement('input');
    sw.type = 'checkbox'; sw.setAttribute('switch', ''); sw.tabIndex = -1;
    hap.appendChild(sw);
    hap.addEventListener('click', e => {
      if (e.target !== hap) return; // clic relayé vers l'input
      const s0 = pending || { i: pickCell(el, e.clientX, e.clientY) };
      pending = null;
      hapticWanted = false;
      doTap(s0);
      if (!hapticWanted || !settings.haptics) e.preventDefault();
      hapticWanted = false;
    });
    wrap.appendChild(hap);
  }

  let start = null;
  wrap.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pending = null;
    start = { x: e.clientX, y: e.clientY, i: pickCell(el, e.clientX, e.clientY), id: e.pointerId };
  });
  wrap.addEventListener('pointercancel', () => (start = null));
  wrap.addEventListener('pointerup', e => {
    if (!start || e.pointerId !== start.id) return;
    const s0 = start; start = null;
    const dx = e.clientX - s0.x, dy = e.clientY - s0.y;
    const cell = el.getBoundingClientRect().width / el._layout.n;
    // glisser une bille (plateau de jeu seulement)
    if (el.id === 'board' && game && !busy && Math.hypot(dx, dy) >= cell * 0.4 && s0.i != null && game.state[s0.i] === 1) {
      const L = el._layout;
      let m = null, bestCos = 0.75;
      for (const mv of movesFrom(game.state, L.n, s0.i, L.dirs)) {
        const a = L.pos[mv.from], b = L.pos[mv.to];
        const vx = b.x - a.x, vy = b.y - a.y;
        const cos = (vx * dx + vy * dy) / (Math.hypot(vx, vy) * Math.hypot(dx, dy));
        if (cos > bestCos) { bestCos = cos; m = mv; }
      }
      if (m) { game.selected = null; doMove(m); return; }
    }
    // toucher : sur iPhone on attend le clic du label, ailleurs on joue tout de suite
    if (hap && Math.hypot(dx, dy) < cell * 0.4) { pending = s0; return; }
    doTap(s0);
  });
}

// --- chrono
let tick = null;
function resumeTimer() {
  if (!game || current !== 'game' || !$('#sheet-end').hidden) return;
  if (game.t0 == null) game.t0 = performance.now();
  clearInterval(tick);
  tick = setInterval(updateTimer, 250);
  updateTimer();
}
function pauseTimer() {
  if (game && game.t0 != null) { game.elapsed += performance.now() - game.t0; game.t0 = null; }
  clearInterval(tick);
  if (game) saveCurrent();
}
function elapsed() { return game ? game.elapsed + (game.t0 != null ? performance.now() - game.t0 : 0) : 0; }
function updateTimer() { $('#game-timer').textContent = fmtTime(elapsed()); }
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pauseTimer(); else if (current === 'game') resumeTimer();
});

// --- sauvegarde de la partie en cours
let saveT = null;
function saveCurrent() {
  if (!game || game.over) return;
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    const { t0, selected, ...rest } = game;
    db.set('current', { ...rest, elapsed: elapsed() });
  }, 120);
}

// ---------------------------------------------------------------- fin de partie
async function finishGame() {
  const time = elapsed();
  pauseTimer();
  game.over = true;
  clearTimeout(saveT);
  const L = layout(game.board);
  const left = countPegs(game.state);
  const initial = countPegs(game.start);
  const centerFinish = left === 1 && L.center >= 0 && game.state[L.center] === 1;
  const pz = currentPuzzle();
  const puzzleOk = pz ? goalMet(pz, game.state) : false;
  const firstSolve = puzzleOk && !solved[pz.id];
  // casse-têtes : des points seulement à la première résolution (pas de farm)
  const points = pz ? (firstSolve ? 100 + initial * 10 : 0) : scoreGame({ initial, left, centerFinish, undos: game.undos });
  if (puzzleOk) {
    const prevS = solved[pz.id];
    if (!prevS || time < prevS.time) solved[pz.id] = { date: Date.now(), time, moves: game.moves, undos: game.undos };
  }
  stats.puzzles = Object.keys(solved).length;
  const prev = stats.best[game.key];
  const improved = !!prev && (left < prev.left || (left === prev.left && time < prev.time));
  const isRecord = !prev || improved;

  // stats
  stats.played++;
  if (left === 1 && !pz) stats.wins++;
  stats.points += points;
  stats.time += time;
  stats.removed += initial - left;
  if (game.custom) stats.customPlayed++;
  if (!pz) stats.boards[game.board] = (stats.boards[game.board] || 0) + 1;
  if (!stats.days.includes(today())) stats.days.push(today());
  const hk = left >= 10 ? '10+' : String(left);
  if (!pz) stats.hist[hk] = (stats.hist[hk] || 0) + 1;
  if (isRecord) stats.best[game.key] = { left, time, date: Date.now(), board: game.board, pegs: initial, classic: game.classic, puzzle: game.puzzle || null };

  const record = {
    key: game.key, board: game.board, classic: game.classic, custom: game.custom, puzzle: game.puzzle || null, solved: puzzleOk,
    initial, left, centerFinish, points, time, moves: game.moves, undos: game.undos,
    maxChain: game.maxChain, date: Date.now(),
  };

  // succès
  // les succès de performance ne comptent que les vraies parties, pas les casse-têtes
  const ctx = pz ? null : { ...record, improved };
  const fresh = [];
  for (const a of ACHIEVEMENTS) {
    if (unlocked[a.id]) continue;
    let ok = false;
    try { ok = a.test(stats, ctx); } catch {}
    if (ok) { unlocked[a.id] = Date.now(); fresh.push(a); }
  }

  await Promise.all([
    db.addGame(record),
    db.set('stats', stats),
    db.set('achievements', unlocked),
    db.set('puzzles', solved),
    db.del('current'),
  ]);

  showEnd({ ...record, isRecord, prev, fresh, firstSolve });
  buzz(left === 1 || puzzleOk ? [30, 60, 30, 60, 80] : [40]);
}

function endMessage(r) {
  if (r.puzzle) {
    const pz = PUZZLES.find(p => p.id === r.puzzle);
    return r.solved ? (r.firstSolve ? 'Bien joué, casse-tête résolu.' : 'Résolu, encore une fois.') : `Objectif manqué : ${goalText(pz).toLowerCase()}.`;
  }
  if (r.left === 1 && r.centerFinish) return 'Parfait. Et pile au centre.';
  if (r.left === 1) return 'Parfait. Une seule bille.';
  if (r.left === 2 && r.board === 'french' && r.classic) return 'Le meilleur résultat possible sur ce départ.';
  if (r.left === 2) return 'À un cheveu.';
  if (r.left === 3) return 'Très propre.';
  if (r.left <= 5) return 'Bien joué.';
  if (r.left <= 8) return 'Pas mal. On peut mieux faire.';
  return 'Plus aucun saut possible.';
}

function showEnd(r) {
  $('#end-kicker').textContent = r.puzzle ? (r.solved ? 'Casse-tête résolu' : 'Objectif manqué') : r.isRecord ? (r.prev ? 'Nouveau record' : 'Premier record') : 'Partie terminée';
  $('#btn-again').textContent = r.puzzle && r.solved ? 'Casse-tête suivant' : 'Rejouer';
  $('#btn-again').dataset.next = r.puzzle && r.solved ? nextPuzzle(r.puzzle) || '' : '';
  $('#end-left').textContent = r.left;
  $('#end-unit').textContent = plural(r.left, 'bille');
  $('#end-msg').textContent = endMessage(r);
  $('#end-points').textContent = '+' + fmtNum(r.points);
  $('#end-time').textContent = fmtTime(r.time);
  const best = stats.best[r.key];
  $('#end-best').textContent = best ? best.left : '—';
  $('#end-ach').innerHTML = r.fresh.map(a => `<div class="new">${a.name} <span>${a.desc}</span></div>`).join('');
  $('#sheet-end').hidden = false;
}

$('#btn-again').onclick = () => {
  $('#sheet-end').hidden = true;
  const next = $('#btn-again').dataset.next;
  if (next) startPuzzle(next); else if ($('#btn-again').textContent === 'Casse-tête suivant') { game = null; go('puzzles'); } else restart();
};
function nextPuzzle(id) {
  const i = PUZZLES.findIndex(p => p.id === id);
  const after = [...PUZZLES.slice(i + 1), ...PUZZLES.slice(0, i)].find(p => !solved[p.id]);
  return after ? after.id : null;
}
$('#btn-end-home').onclick = () => { $('#sheet-end').hidden = true; game = null; go('home'); };

// ---------------------------------------------------------------- accueil
function renderHome() {
  $('#home-points').textContent = fmtNum(stats.points);
  const b = settings.classicBoard;
  const best = stats.best[startKey(b, makeState(b))];
  $('#classic-best').textContent = `${BOARDS[b].name} · ${best ? 'record ' + best.left : BOARDS[b].holes + ' trous'}`;
  $('#home-boards').innerHTML = BOARD_ORDER.map(id =>
    `<button class="chip" data-board="${id}" aria-pressed="${id === b}">${BOARDS[id].name}<small>${BOARDS[id].holes}</small></button>`).join('');
  $('#pz-count').textContent = `${Object.keys(solved).length}/${PUZZLES.length} résolus`;
  $('#ach-count').textContent = `${Object.keys(unlocked).length}/${ACHIEVEMENTS.length}`;
  $('#resume-wrap').hidden = !game || game.over || game.moves === 0;
  if (game) $('#btn-resume').textContent = `Reprendre · ${BOARDS[game.board].name} · ${countPegs(game.state)} billes`;
}

$('#btn-classic').onclick = () => startClassic();
$('#home-boards').onclick = e => {
  const c = e.target.closest('[data-board]');
  if (!c) return;
  settings.classicBoard = c.dataset.board; saveSettings(); buzz(5); renderHome();
};
$('#btn-resume').onclick = () => {
  if (!game) return;
  buildBoard($('#board'), game.board, onGameCell);
  go('game'); renderGame();
};
$('#btn-quit').onclick = () => { game && (game.selected = null); go('home'); };
$('#btn-undo').onclick = undo;
$('#btn-restart').onclick = () => {
  if (game && game.moves > 3 && !confirm('Recommencer cette partie ?')) return;
  restart();
};

function miniBoard(boardId, state, goal = -1, size = 64) {
  const L = layout(boardId), n = L.n, s = 10;
  let dots = '';
  L.cells.forEach((v, i) => {
    if (!v) return;
    const p = L.pos[i], x = p.x * s + s / 2, y = p.y * s + s / 2;
    if (state[i] === 1) dots += `<circle cx="${x}" cy="${y}" r="3.4" fill="currentColor"/>`;
    else dots += `<circle cx="${x}" cy="${y}" r="1.4" fill="currentColor" fill-opacity=".3"/>`;
    if (i === goal) dots += `<circle cx="${x}" cy="${y}" r="4.6" fill="none" stroke="currentColor" stroke-width="1.1"/>`;
  });
  return `<svg viewBox="0 0 ${n * s} ${n * s}" width="${size}" height="${size}">${dots}</svg>`;
}

function renderPuzzles() {
  const done = Object.keys(solved).length;
  $('#pz-progress').textContent = `${done}/${PUZZLES.length}`;
  $('#pz-content').innerHTML = PUZZLES.map((p, k) => {
    const st = puzzleState(p), sv = solved[p.id];
    return `<button class="pz${sv ? ' done' : ''}" data-pz="${p.id}">
      <span class="pz-mini">${miniBoard(p.board, st, goalCell(p))}</span>
      <span class="pz-txt"><span class="label">${String(k + 1).padStart(2, '0')} · ${BOARDS[p.board].name} · ${countPegs(st)} billes</span>
        <b>${p.name}</b><small>${goalText(p)}</small></span>
      <span class="pz-state">${sv ? '✓' : ''}</span></button>`;
  }).join('');
}
$('#pz-content').onclick = e => { const b = e.target.closest('[data-pz]'); if (b) startPuzzle(b.dataset.pz); };

function heroMark() {
  // mini plateau anglais, trou central vide
  const n = 7, s = 9, L = layout('english');
  let dots = '';
  L.cells.forEach((v, i) => {
    if (!v) return;
    const x = (i % n) * s + s / 2, y = Math.floor(i / n) * s + s / 2;
    dots += i === L.center
      ? `<circle cx="${x}" cy="${y}" r="2.6" fill="none" stroke="currentColor" stroke-opacity=".35" stroke-width="1"/>`
      : `<circle cx="${x}" cy="${y}" r="3.2" fill="currentColor"/>`;
  });
  $('.hero-mark').innerHTML = `<svg viewBox="0 0 ${n * s} ${n * s}" width="72" height="72">${dots}</svg>`;
}

// ---------------------------------------------------------------- départ libre
function renderSetup() {
  const chips = $('#board-chips');
  chips.innerHTML = BOARD_ORDER.map(id =>
    `<button class="chip" data-board="${id}" aria-pressed="${id === setup.board}">${BOARDS[id].name}<small>${BOARDS[id].holes}</small></button>`
  ).join('');
  chips.onclick = e => {
    const b = e.target.closest('[data-board]');
    if (!b || b.dataset.board === setup.board) return;
    setup.board = b.dataset.board;
    setup.state = makeState(setup.board);
    renderSetup();
  };
  if (!setup.state || setup.state.length !== layout(setup.board).cells.length) setup.state = makeState(setup.board);
  buildBoard($('#setup-board'), setup.board, i => {
    setup.state[i] = setup.state[i] === 1 ? 0 : 1;
    buzz(5);
    paintSetup();
  });
  paintSetup();
}

function paintSetup() {
  paintBoard($('#setup-board'), setup.state);
  const pegs = countPegs(setup.state);
  const L = layout(setup.board);
  const ok = hasMoves(setup.state, L.n, L.dirs);
  $('#setup-count').textContent = `${pegs} ${plural(pegs, 'bille')}`;
  const best = stats.best[startKey(setup.board, setup.state)];
  $('#setup-hint').textContent = !ok
    ? 'Aucun saut possible depuis cette position.'
    : best ? `Record sur cette position : ${best.left} ${plural(best.left, 'bille')}` : 'Touche un trou pour retirer ou remettre une bille.';
  $('#btn-setup-play').disabled = !ok;
}

$('#setup-full').onclick = () => { setup.state = setup.state.map(v => (v === null ? null : 1)); paintSetup(); };
$('#setup-center').onclick = () => { setup.state = makeState(setup.board); paintSetup(); };
$('#setup-invert').onclick = () => { setup.state = setup.state.map(v => (v === null ? null : 1 - v)); paintSetup(); };
$('#setup-random').onclick = () => {
  const L = layout(setup.board);
  const idx = L.cells.map((v, i) => (v ? i : -1)).filter(i => i >= 0);
  let s;
  do { s = makeState(setup.board, [idx[Math.floor(Math.random() * idx.length)]]); } while (!hasMoves(s, L.n, L.dirs));
  setup.state = s; paintSetup();
};
$('#btn-setup-play').onclick = () => {
  const classic = isClassicStart(setup.board, setup.state);
  newGame(setup.board, setup.state, !classic);
};

// ---------------------------------------------------------------- records
async function renderStats() {
  const el = $('#stats-content');
  const games = (await db.allGames()).sort((a, b) => b.date - a.date);
  const classicRows = BOARD_ORDER.map(id => {
    const best = stats.best[startKey(id, makeState(id))];
    return `<div class="item"><div><div class="t">${BOARDS[id].name}</div><div class="s">${BOARDS[id].holes} trous · ${stats.boards[id] || 0} ${plural(stats.boards[id] || 0, 'partie')}</div></div>
      <div class="v">${best ? best.left : '—'}<small>${best ? fmtTime(best.time) : ''}</small></div></div>`;
  }).join('');

  const customs = Object.entries(stats.best).filter(([, v]) => !v.classic && !v.puzzle)
    .sort((a, b) => a[1].left - b[1].left || b[1].date - a[1].date).slice(0, 8);
  const customRows = customs.length ? customs.map(([, v]) =>
    `<div class="item"><div><div class="t">${BOARDS[v.board].name} · ${v.pegs} billes au départ</div><div class="s">${new Date(v.date).toLocaleDateString('fr-FR')}</div></div>
      <div class="v">${v.left}<small>${fmtTime(v.time)}</small></div></div>`).join('')
    : '<p class="empty">Aucune partie en départ libre.</p>';

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10+'];
  const max = Math.max(1, ...keys.map(k => stats.hist[k] || 0));
  const bars = keys.map(k => {
    const v = stats.hist[k] || 0;
    return `<div class="bar${v ? '' : ' zero'}"><i style="height:${Math.max(2, (v / max) * 100)}%"></i><span>${k}</span></div>`;
  }).join('');

  const recent = games.slice(0, 12).map(g =>
    `<div class="item"><div><div class="t">${BOARDS[g.board].name}${g.classic ? '' : ' · libre'}</div><div class="s">${new Date(g.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} · ${fmtTime(g.time)} · +${fmtNum(g.points)} pts</div></div>
      <div class="v">${g.left}</div></div>`).join('');

  el.innerHTML = `
    <div class="kpis">
      <div class="kpi"><span class="label">Parties</span><b>${fmtNum(stats.played)}</b></div>
      <div class="kpi"><span class="label">Points</span><b>${fmtNum(stats.points)}</b></div>
      <div class="kpi"><span class="label">À 1 bille</span><b>${fmtNum(stats.wins)}</b></div>
      <div class="kpi"><span class="label">Temps de jeu</span><b>${fmtTime(stats.time)}</b></div>
    </div>
    <span class="label section-title">Départ classique · meilleur score</span>
    <div class="list">${classicRows}</div>
    <span class="label section-title">Billes restantes en fin de partie</span>
    <div class="bars">${bars}</div>
    <span class="label section-title">Départs libres</span>
    <div class="list">${customRows}</div>
    <span class="label section-title">Dernières parties</span>
    <div class="list">${recent || '<p class="empty">Pas encore de partie terminée.</p>'}</div>`;
}

// ---------------------------------------------------------------- succès
function renderAchievements() {
  const done = Object.keys(unlocked).length;
  $('#ach-progress').textContent = `${done}/${ACHIEVEMENTS.length}`;
  const sorted = [...ACHIEVEMENTS].sort((a, b) => (unlocked[b.id] ? 1 : 0) - (unlocked[a.id] ? 1 : 0));
  $('#ach-content').innerHTML = sorted.map(a => {
    const u = unlocked[a.id];
    let extra = '';
    if (u) extra = ` · <em>${new Date(u).toLocaleDateString('fr-FR')}</em>`;
    else if (a.progress) { const [c, m] = a.progress(stats); extra = ` · <em>${fmtNum(Math.min(c, m))}/${fmtNum(m)}</em>`; }
    return `<div class="ach${u ? ' done' : ''}"><div class="badge">${a.mark}</div><div><div class="t">${a.name}</div><div class="s">${a.desc}${extra}</div></div></div>`;
  }).join('');
}

// ---------------------------------------------------------------- réglages
function applyTheme() {
  document.documentElement.dataset.theme = settings.light ? 'light' : 'dark';
  $('meta[name="theme-color"]').content = settings.light ? '#ffffff' : '#000000';
}
function renderSettings() {
  $('#set-haptics').checked = settings.haptics;
  $('#set-hints').checked = settings.hints;
  $('#set-light').checked = settings.light;
  $('#set-classic').innerHTML = BOARD_ORDER.map(id => `<option value="${id}"${id === settings.classicBoard ? ' selected' : ''}>${BOARDS[id].name} · ${BOARDS[id].holes}</option>`).join('');
  $('#version').textContent = 'v' + VERSION;
}
function saveSettings() { db.set('settings', settings); applyTheme(); }
$('#set-haptics').onchange = e => { settings.haptics = e.target.checked; saveSettings(); paintHapticBtn(); buzz(10); };
function paintHapticBtn() {
  const b = $('#btn-haptic');
  b.setAttribute('aria-pressed', String(settings.haptics));
  b.title = settings.haptics ? 'Vibrations activées' : 'Vibrations désactivées';
}
$('#btn-haptic').onclick = () => {
  settings.haptics = !settings.haptics;
  saveSettings(); paintHapticBtn();
  toast(settings.haptics ? 'Vibrations activées' : 'Vibrations désactivées');
  buzz(30);
};
$('#set-hints').onchange = e => { settings.hints = e.target.checked; saveSettings(); };
$('#set-light').onchange = e => { settings.light = e.target.checked; saveSettings(); };
$('#set-classic').onchange = e => { settings.classicBoard = e.target.value; saveSettings(); };

$('#btn-export').onclick = async () => {
  const data = { app: 'solitaire', version: VERSION, exported: new Date().toISOString(), kv: await db.allKV(), games: await db.allGames() };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `solitaire-${today()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
$('#btn-import').onclick = () => $('#import-file').click();
$('#import-file').onchange = async e => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (data.app !== 'solitaire') throw new Error();
    if (!confirm('Remplacer toutes les données de cet appareil par ce fichier ?')) return;
    await db.importAll(data);
    location.reload();
  } catch { toast('Fichier invalide'); }
  e.target.value = '';
};
$('#btn-reset').onclick = async () => {
  if (!confirm('Effacer définitivement parties, records, points et succès ?')) return;
  await db.clearAll();
  location.reload();
};

// ---------------------------------------------------------------- démarrage
async function init() {
  heroMark();
  settings = { ...DEFAULT_SETTINGS, ...(await db.get('settings', {})) };
  if (settings.v !== 2) { settings.classicBoard = 'english'; settings.v = 2; db.set('settings', settings); }
  stats = { ...structuredClone(DEFAULT_STATS), ...(await db.get('stats', {})) };
  unlocked = await db.get('achievements', {});
  solved = await db.get('puzzles', {});
  const saved = await db.get('current');
  if (saved && BOARDS[saved.board]) game = { ...saved, t0: null, selected: null };
  setup.board = settings.classicBoard;
  applyTheme();
  paintHapticBtn();
  go('home');
  db.persist();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
init();
