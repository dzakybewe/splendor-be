import type { Color, Noble } from '../types.js';
import { NOBLE_POINTS } from './constants.js';
import { emptyCost } from './utils.js';

/**
 * The 10 nobles, all worth 3 points.
 *
 * Same rotational structure as the cards: five nobles want 4 bonuses of each of two
 * adjacent colours on the wheel, and five want 3 bonuses of each of three adjacent
 * colours. Every colour is therefore asked for exactly twice by each group.
 */
const WHEEL = ['diamond', 'sapphire', 'emerald', 'ruby', 'onyx'] as const satisfies readonly Color[];

function colorAt(index: number): Color {
  const color = WHEEL[index % WHEEL.length];
  if (color === undefined) throw new Error('unreachable: colour wheel index out of range');
  return color;
}

function buildNobles(): Noble[] {
  const nobles: Noble[] = [];

  // Five "4 + 4" nobles, one per adjacent colour pair.
  for (let start = 0; start < WHEEL.length; start += 1) {
    const requirement = emptyCost();
    requirement[colorAt(start)] = 4;
    requirement[colorAt(start + 1)] = 4;
    nobles.push({ id: `noble-pair-${start + 1}`, requirement, points: NOBLE_POINTS });
  }

  // Five "3 + 3 + 3" nobles, one per adjacent colour triple.
  for (let start = 0; start < WHEEL.length; start += 1) {
    const requirement = emptyCost();
    requirement[colorAt(start)] = 3;
    requirement[colorAt(start + 1)] = 3;
    requirement[colorAt(start + 2)] = 3;
    nobles.push({ id: `noble-triple-${start + 1}`, requirement, points: NOBLE_POINTS });
  }

  return nobles;
}

export const ALL_NOBLES: readonly Noble[] = buildNobles();
