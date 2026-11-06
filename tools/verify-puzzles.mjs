// Vérifie que chaque casse-tête est résoluble : recherche exhaustive en profondeur,
// positions codées en bits et mémoïsées. Affiche une solution pour chacun.
// Usage : node tools/verify-puzzles.mjs [id]
import { PUZZLES, puzzleState, goalCell, goalMet } from '../puzzles.js';
import { layout, movesFrom, applyMove, hasMoves } from '../game.js';

// Rejoue une solution avec le moteur du jeu : chaque coup doit être légal et la fin doit atteindre l'objectif.
function replay(p, path) {
  const L = layout(p.board);
  let s = puzzleState(p);
  for (const [from, to] of path) {
    const m = movesFrom(s, L.n, from, L.dirs).find(m => m.to === to);
    if (!m) return false;
    s = applyMove(s, m);
  }
  return !hasMoves(s, L.n, L.dirs) && goalMet(p, s);
}

const LIMIT = Number(process.env.LIMIT || 12_000_000); // positions explorées max par casse-tête

function solver(p) {
  const L = layout(p.board), n = L.n;
  const idx = []; L.cells.forEach((v, i) => v && idx.push(i));
  const bit = new Map(idx.map((c, k) => [c, k]));
  // chaque position = deux entiers 32 bits (lo: trous 0..31, hi: 32..)
  const moves = [];
  for (const c of idx) {
    const r = Math.floor(c / n), cc = c % n;
    for (const [dr, dc] of L.dirs) {
      const r2 = r + 2 * dr, c2 = cc + 2 * dc;
      if (r2 < 0 || r2 >= n || c2 < 0 || c2 >= n) continue;
      const o = (r + dr) * n + cc + dc, t = r2 * n + c2;
      if (bit.has(o) && bit.has(t)) moves.push([bit.get(c), bit.get(o), bit.get(t), c, t]);
    }
  }
  const has = (lo, hi, k) => (k < 32 ? (lo >>> k) & 1 : (hi >>> (k - 32)) & 1);
  const flip = (lo, hi, k) => (k < 32 ? [(lo ^ (1 << k)) >>> 0, hi] : [lo, (hi ^ (1 << (k - 32))) >>> 0]);
  let lo = 0, hi = 0;
  const st = puzzleState(p);
  idx.forEach((c, k) => { if (st[c] === 1) [lo, hi] = flip(lo, hi, k); });
  const gc = goalCell(p), gk = gc >= 0 ? bit.get(gc) : -1;
  const seen = new Set();
  const path = [];
  let aborted = false;
  const popc = x => { x -= (x >>> 1) & 0x55555555; x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24; };
  const goal = (lo, hi) => {
    const left = popc(lo) + popc(hi);
    if (p.goal.type === 'max') return left <= p.goal.left;
    if (p.goal.type === 'one') return left === 1;
    return left === 1 && has(lo, hi, gk) === 1;
  };
  const dfs = (lo, hi) => {
    const key = hi * 4294967296 + lo;
    if (seen.has(key)) return false;
    if (seen.size >= LIMIT) { aborted = true; return false; }
    seen.add(key);
    let any = false;
    for (const [a, b, c, from, to] of moves) {
      if (has(lo, hi, a) && has(lo, hi, b) && !has(lo, hi, c)) {
        any = true;
        let [l2, h2] = flip(lo, hi, a); [l2, h2] = flip(l2, h2, b); [l2, h2] = flip(l2, h2, c);
        path.push([from, to]);
        if (dfs(l2, h2)) return true;
        path.pop();
        if (aborted) return false;
      }
    }
    return !any && goal(lo, hi);
  };
  const t0 = Date.now();
  const ok = dfs(lo, hi);
  return { ok, aborted, states: seen.size, ms: Date.now() - t0, path, pegs: popc(lo) + popc(hi) };
}

const only = process.argv[2];
let allOk = true;
for (const p of PUZZLES) {
  if (only && p.id !== only) continue;
  const r = solver(p);
  if (r.ok && !replay(p, r.path)) { r.ok = false; r.aborted = false; console.log(`  ! ${p.id} : la solution ne rejoue pas dans le moteur du jeu`); }
  const tag = r.ok ? '✓' : r.aborted ? '?' : '✗';
  console.log(`${tag} ${p.id.padEnd(18)} ${String(r.pegs).padStart(2)} billes  ${r.ok ? r.path.length + ' coups' : r.aborted ? 'NON VÉRIFIÉ (limite)' : 'IMPOSSIBLE'}  ${r.states} positions, ${r.ms} ms`);
  if (!r.ok) allOk = false;
}
process.exit(allOk ? 0 : 1);
