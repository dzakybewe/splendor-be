import type { Card, Color, Tier } from '../types.js';
import { emptyCost } from './utils.js';

/**
 * The 90 development cards.
 *
 * The real Splendor deck is rotationally symmetric: within a tier, every bonus colour
 * gets the same set of cost shapes, rotated one step around the colour wheel. So rather
 * than transcribing 90 card literals (and getting one of them subtly wrong), the deck is
 * generated from that structure.
 *
 * Read a pattern as "relative to my own bonus colour": `[2, 4]` means "4 tokens of the
 * colour two steps clockwise from my bonus colour". Step 0 is the bonus colour itself.
 * Rotating a pattern across all five colours reproduces the printed deck exactly, and
 * guarantees the 8/6/4 cards-per-colour split per tier for free.
 */
const WHEEL = ['diamond', 'sapphire', 'emerald', 'ruby', 'onyx'] as const satisfies readonly Color[];

/** `[stepsFromBonusColor, tokenCount]`. */
type CostPattern = [number, number][];

interface CardPattern {
  points: number;
  cost: CostPattern;
}

/** Tier 1 — 8 shapes x 5 colours = 40 cards. Seven 0-point cards and one 1-point card. */
const TIER1_PATTERNS: CardPattern[] = [
  { points: 0, cost: [[1, 1], [2, 1], [3, 1], [4, 1]] },
  { points: 0, cost: [[1, 1], [2, 2], [3, 1], [4, 1]] },
  { points: 0, cost: [[1, 2], [2, 2], [4, 1]] },
  { points: 0, cost: [[0, 1], [3, 1], [4, 3]] },
  { points: 0, cost: [[3, 2], [4, 1]] },
  { points: 0, cost: [[3, 2], [4, 2]] },
  { points: 0, cost: [[3, 3]] },
  { points: 1, cost: [[2, 4]] },
];

/** Tier 2 — 6 shapes x 5 colours = 30 cards. Two 1-point, three 2-point, one 3-point. */
const TIER2_PATTERNS: CardPattern[] = [
  { points: 1, cost: [[1, 3], [2, 2], [3, 2]] },
  { points: 1, cost: [[0, 2], [1, 3], [3, 3]] },
  { points: 2, cost: [[2, 1], [3, 4], [4, 2]] },
  { points: 2, cost: [[3, 5], [4, 3]] },
  { points: 2, cost: [[1, 5]] },
  { points: 3, cost: [[4, 6]] },
];

/** Tier 3 — 4 shapes x 5 colours = 20 cards. One 3-point, two 4-point, one 5-point. */
const TIER3_PATTERNS: CardPattern[] = [
  { points: 3, cost: [[1, 3], [2, 3], [3, 5], [4, 3]] },
  { points: 4, cost: [[4, 7]] },
  { points: 4, cost: [[0, 3], [3, 3], [4, 6]] },
  { points: 5, cost: [[0, 3], [4, 7]] },
];

const PATTERNS_BY_TIER: Record<Tier, CardPattern[]> = {
  1: TIER1_PATTERNS,
  2: TIER2_PATTERNS,
  3: TIER3_PATTERNS,
};

function buildTier(tier: Tier): Card[] {
  const cards: Card[] = [];
  for (const [bonusIndex, bonus] of WHEEL.entries()) {
    PATTERNS_BY_TIER[tier].forEach((pattern, patternIndex) => {
      const cost = emptyCost();
      for (const [steps, amount] of pattern.cost) {
        const color = WHEEL[(bonusIndex + steps) % WHEEL.length];
        // WHEEL has five entries and the index is taken mod its length, so this holds.
        if (color === undefined) throw new Error('unreachable: colour wheel index out of range');
        cost[color] = amount;
      }
      cards.push({
        id: `t${tier}-${bonus}-${patternIndex + 1}`,
        tier,
        cost,
        bonus,
        points: pattern.points,
      });
    });
  }
  return cards;
}

export const TIER1_CARDS: readonly Card[] = buildTier(1);
export const TIER2_CARDS: readonly Card[] = buildTier(2);
export const TIER3_CARDS: readonly Card[] = buildTier(3);

export const ALL_CARDS: readonly Card[] = [...TIER1_CARDS, ...TIER2_CARDS, ...TIER3_CARDS];

export const CARDS_BY_TIER = {
  tier1: TIER1_CARDS,
  tier2: TIER2_CARDS,
  tier3: TIER3_CARDS,
} as const;

const CARD_INDEX = new Map<string, Card>(ALL_CARDS.map((card) => [card.id, card]));

export function getCardById(cardId: string): Card | undefined {
  return CARD_INDEX.get(cardId);
}
