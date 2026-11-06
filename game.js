// Logique pure du solitaire : plateaux, coups, fin de partie.

const SQ = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const TRI = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1]];

export const BOARDS = {
  english: {
    id: 'english', name: 'Anglais', holes: 33, n: 7, desc: 'La croix simple',
    valid: (r, c) => (r >= 2 && r <= 4) || (c >= 2 && c <= 4),
  },
  french: {
    id: 'french', name: 'Français', holes: 37, n: 7, desc: 'Croix + angles',
    valid: (r, c) => (r >= 2 && r <= 4) || (c >= 2 && c <= 4) || (r >= 1 && r <= 5 && c >= 1 && c <= 5),
  },
  german: {
    id: 'german', name: 'Allemand', holes: 45, n: 9, desc: 'Grande croix',
    valid: (r, c) => (r >= 3 && r <= 5) || (c >= 3 && c <= 5),
  },
  asym: {
    id: 'asym', name: 'Asymétrique', holes: 39, n: 8, desc: 'Croix décalée',
    valid: (r, c) => (r >= 2 && r <= 4) || (c >= 2 && c <= 4),
    center: [3, 3],
  },
  diamond: {
    id: 'diamond', name: 'Diamant', holes: 41, n: 9, desc: 'Losange',
    valid: (r, c) => Math.abs(r - 4) + Math.abs(c - 4) <= 4,
  },
  triangle: {
    id: 'triangle', name: 'Triangle', holes: 15, n: 5, desc: '6 directions',
    valid: (r, c) => c <= r,
    tri: true, start: [0, 0], center: null,
  },
};
export const BOARD_ORDER = ['english', 'french', 'german', 'asym', 'diamond', 'triangle'];

const cache = {};
export function layout(boardId) {
  if (cache[boardId]) return cache[boardId];
  const b = BOARDS[boardId];
  const n = b.n;
  const cells = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) cells.push(b.valid(r, c));
  const mid = Math.floor(n / 2);
  const center = b.center === null ? -1 : b.center ? b.center[0] * n + b.center[1] : mid * n + mid;
  const start = b.start ? b.start[0] * n + b.start[1] : center;
  const dirs = b.tri ? TRI : SQ;
  // position d'affichage de chaque trou, en unités de case (0..n)
  const H = 0.866;
  const pos = cells.map((_, i) => {
    const r = Math.floor(i / n), c = i % n;
    if (!b.tri) return { x: c, y: r };
    return { x: c + (n - 1 - r) / 2, y: r * H + ((n - 1) * (1 - H)) / 2 };
  });
  return (cache[boardId] = { ...b, cells, center, start, dirs, pos });
}

/** Plateau plein, sauf les indices de `empty`. Retourne un tableau : null (hors plateau), 1 (bille), 0 (trou). */
export function makeState(boardId, empty = null) {
  const L = layout(boardId);
  const holes = new Set(empty ?? [L.start]);
  return L.cells.map((v, i) => (v ? (holes.has(i) ? 0 : 1) : null));
}

export function countPegs(state) {
  let n = 0;
  for (const v of state) if (v === 1) n++;
  return n;
}

/** Coups possibles d'une bille : [{from, over, to}] */
export function movesFrom(state, n, from, dirs = SQ) {
  if (state[from] !== 1) return [];
  const r = Math.floor(from / n), c = from % n;
  const out = [];
  for (const [dr, dc] of dirs) {
    const r1 = r + dr, c1 = c + dc, r2 = r + 2 * dr, c2 = c + 2 * dc;
    if (r2 < 0 || r2 >= n || c2 < 0 || c2 >= n) continue;
    const over = r1 * n + c1, to = r2 * n + c2;
    if (state[over] === 1 && state[to] === 0) out.push({ from, over, to });
  }
  return out;
}

export function allMoves(state, n, dirs = SQ) {
  const out = [];
  for (let i = 0; i < state.length; i++) if (state[i] === 1) out.push(...movesFrom(state, n, i, dirs));
  return out;
}

export function hasMoves(state, n, dirs = SQ) {
  for (let i = 0; i < state.length; i++) if (state[i] === 1 && movesFrom(state, n, i, dirs).length) return true;
  return false;
}

export function applyMove(state, m) {
  const s = state.slice();
  s[m.from] = 0; s[m.over] = 0; s[m.to] = 1;
  return s;
}

/** Clé unique d'une position de départ (pour les records). */
export function startKey(boardId, state) {
  return boardId + ':' + state.filter(v => v !== null).map(v => v).join('');
}

export function isClassicStart(boardId, state) {
  return startKey(boardId, state) === startKey(boardId, makeState(boardId));
}

/** Points d'une partie terminée. */
export function scoreGame({ initial, left, centerFinish, undos }) {
  let pts = (initial - left) * 10;
  if (left === 1) pts += 500;
  else if (left === 2) pts += 200;
  else if (left === 3) pts += 100;
  else if (left <= 5) pts += 40;
  if (left === 1 && centerFinish) pts += 300;
  if (undos === 0) pts = Math.round(pts * 1.2);
  return pts;
}
