// Casse-têtes : une position de départ et un objectif.
// Chaque grille est écrite ligne par ligne : 'o' = bille, '.' = trou vide, ' ' = hors plateau.
// goal : { type: 'at', cell: [r, c] }  → finir avec une seule bille, sur ce trou
//        { type: 'one' }                → finir avec une seule bille, n'importe où
//        { type: 'max', left: N }       → finir avec N billes ou moins
// Tous ont été vérifiés résolubles par un solveur exhaustif (voir tools/verify-puzzles.mjs).

export const PUZZLES = [
  { id: 'croix', name: 'La croix', board: 'english', goal: { type: 'at', cell: [3, 3] },
    grid: [
      '  ...  ',
      '  .o.  ',
      '..ooo..',
      '...o...',
      '...o...',
      '  ...  ',
      '  ...  ',
    ] },
  { id: 'plus', name: 'Le plus', board: 'english', goal: { type: 'at', cell: [3, 3] },
    grid: [
      '  ...  ',
      '  .o.  ',
      '...o...',
      '.ooooo.',
      '...o...',
      '  .o.  ',
      '  ...  ',
    ] },
  { id: 'cheminee', name: 'La cheminée', board: 'english', goal: { type: 'at', cell: [3, 3] },
    grid: [
      '  ooo  ',
      '  ooo  ',
      '..ooo..',
      '..o.o..',
      '.......',
      '  ...  ',
      '  ...  ',
    ] },
  { id: 'fleche', name: 'La flèche', board: 'english', goal: { type: 'at', cell: [3, 3] },
    grid: [
      '  .o.  ',
      '  ooo  ',
      '.ooooo.',
      '...o...',
      '...o...',
      '  ooo  ',
      '  ooo  ',
    ] },
  { id: 'pyramide', name: 'La pyramide', board: 'english', goal: { type: 'at', cell: [3, 3] },
    grid: [
      '  ...  ',
      '  .o.  ',
      '..ooo..',
      '.ooooo.',
      'ooooooo',
      '  ...  ',
      '  ...  ',
    ] },
  { id: 'diamant', name: 'Le diamant', board: 'english', goal: { type: 'at', cell: [3, 3] },
    grid: [
      '  .o.  ',
      '  ooo  ',
      '.ooooo.',
      'ooo.ooo',
      '.ooooo.',
      '  ooo  ',
      '  .o.  ',
    ] },
  { id: 'coin', name: 'D\'un bout à l\'autre', board: 'english', goal: { type: 'at', cell: [6, 2] },
    grid: [
      '  .oo  ',
      '  ooo  ',
      'ooooooo',
      'ooooooo',
      'ooooooo',
      '  ooo  ',
      '  ooo  ',
    ] },
  { id: 'bord', name: 'Retour au bord', board: 'english', goal: { type: 'at', cell: [0, 3] },
    grid: [
      '  ooo  ',
      '  ooo  ',
      'ooooooo',
      'ooo.ooo',
      'ooooooo',
      '  ooo  ',
      '  ooo  ',
    ] },
  { id: 'francais', name: 'Le vrai français', board: 'french', goal: { type: 'one' },
    grid: [
      '  ooo  ',
      ' oo.oo ',
      'ooooooo',
      'ooooooo',
      'ooooooo',
      ' ooooo ',
      '  ooo  ',
    ] },
  { id: 'francais-centre', name: 'Deux au mieux', board: 'french', goal: { type: 'max', left: 2 },
    grid: [
      '  ooo  ',
      ' ooooo ',
      'ooooooo',
      'ooo.ooo',
      'ooooooo',
      ' ooooo ',
      '  ooo  ',
    ] },
  { id: 'triangle-coin', name: 'Pointe', board: 'triangle', goal: { type: 'at', cell: [0, 0] },
    grid: [
      '.    ',
      'oo   ',
      'ooo  ',
      'oooo ',
      'ooooo',
    ] },
  { id: 'triangle-milieu', name: 'Cœur du triangle', board: 'triangle', goal: { type: 'one' },
    grid: [
      'o    ',
      'oo   ',
      'o.o  ',
      'oooo ',
      'ooooo',
    ] },
];

import { layout } from './game.js';

/** État de départ (tableau null / 0 / 1) d'un casse-tête. */
export function puzzleState(p) {
  const L = layout(p.board);
  const out = L.cells.map(() => null);
  p.grid.forEach((row, r) => {
    for (let c = 0; c < L.n; c++) {
      const ch = row[c] ?? ' ';
      const i = r * L.n + c;
      if (L.cells[i]) {
        if (ch !== 'o' && ch !== '.') throw new Error(`${p.id}: trou (${r},${c}) non défini`);
        out[i] = ch === 'o' ? 1 : 0;
      } else if (ch !== ' ') throw new Error(`${p.id}: (${r},${c}) hors plateau`);
    }
  });
  return out;
}

export function goalCell(p) {
  return p.goal.type === 'at' ? p.goal.cell[0] * layout(p.board).n + p.goal.cell[1] : -1;
}

/** L'objectif est-il atteint par cet état final ? */
export function goalMet(p, state) {
  const left = state.reduce((a, v) => a + (v === 1 ? 1 : 0), 0);
  if (p.goal.type === 'max') return left <= p.goal.left;
  if (p.goal.type === 'one') return left === 1;
  return left === 1 && state[goalCell(p)] === 1;
}

export function goalText(p) {
  if (p.goal.type === 'max') return `Finir avec ${p.goal.left} billes ou moins`;
  if (p.goal.type === 'one') return 'Finir avec une seule bille';
  return 'Une seule bille, sur le trou marqué';
}
