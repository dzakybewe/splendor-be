import { ALL_CARDS, CARDS_BY_TIER } from '../src/engine/cards.js';
import { ALL_NOBLES } from '../src/engine/nobles.js';
import { createBank, createGame, nobleCountFor, shuffle } from '../src/engine/gameState.js';
import { COLORS, TIER_KEYS } from '../src/types.js';
import type { Color, Tier } from '../src/types.js';
import { newGame, seededRng, seeds } from './helpers.js';

/**
 * The deck is generated from rotational patterns rather than transcribed card by card,
 * so these assertions are the cross-check against the printed game: totals, the
 * cards-per-colour split, and the point spread per tier.
 */
describe('card data', () => {
  it('has 90 cards split 40 / 30 / 20 across the tiers', () => {
    expect(ALL_CARDS).toHaveLength(90);
    expect(CARDS_BY_TIER.tier1).toHaveLength(40);
    expect(CARDS_BY_TIER.tier2).toHaveLength(30);
    expect(CARDS_BY_TIER.tier3).toHaveLength(20);
  });

  it('gives every colour an equal share of each tier', () => {
    const expectedPerColor: Record<Tier, number> = { 1: 8, 2: 6, 3: 4 };
    for (const tierKey of TIER_KEYS) {
      const cards = CARDS_BY_TIER[tierKey];
      const tier = cards[0]?.tier;
      expect(tier).toBeDefined();
      for (const color of COLORS) {
        const owned = cards.filter((card) => card.bonus === color);
        expect(owned).toHaveLength(expectedPerColor[tier as Tier]);
      }
    }
  });

  it('matches the printed point spread per tier', () => {
    const tally = (tierKey: (typeof TIER_KEYS)[number]) => {
      const counts = new Map<number, number>();
      for (const card of CARDS_BY_TIER[tierKey]) {
        counts.set(card.points, (counts.get(card.points) ?? 0) + 1);
      }
      return Object.fromEntries([...counts].sort((a, b) => a[0] - b[0]));
    };

    // Per colour the printed spread is: tier 1 = seven 0-point cards and one 1-pointer,
    // tier 2 = 1,1,2,2,2,3, tier 3 = 3,4,4,5. Times five colours.
    expect(tally('tier1')).toEqual({ 0: 35, 1: 5 });
    expect(tally('tier2')).toEqual({ 1: 10, 2: 15, 3: 5 });
    expect(tally('tier3')).toEqual({ 3: 5, 4: 10, 5: 5 });
  });

  it('never asks for gold and never costs nothing', () => {
    for (const card of ALL_CARDS) {
      const total = COLORS.reduce((sum, color) => sum + card.cost[color], 0);
      expect(total).toBeGreaterThan(0);
      expect(Object.keys(card.cost).sort()).toEqual([...COLORS].sort());
    }
  });

  it('gives every card a unique id', () => {
    expect(new Set(ALL_CARDS.map((card) => card.id)).size).toBe(90);
  });

  it('keeps the one-point tier 1 card a single-colour cost of four', () => {
    const onePointers = CARDS_BY_TIER.tier1.filter((card) => card.points === 1);
    expect(onePointers).toHaveLength(5);
    for (const card of onePointers) {
      const nonZero = COLORS.filter((color) => card.cost[color] > 0);
      expect(nonZero).toHaveLength(1);
      expect(card.cost[nonZero[0] as Color]).toBe(4);
    }
  });
});

describe('noble data', () => {
  it('has 10 nobles worth 3 points each', () => {
    expect(ALL_NOBLES).toHaveLength(10);
    for (const noble of ALL_NOBLES) expect(noble.points).toBe(3);
  });

  it('is five 4+4 nobles and five 3+3+3 nobles', () => {
    const shapes = ALL_NOBLES.map((noble) =>
      COLORS.map((color) => noble.requirement[color])
        .filter((n) => n > 0)
        .sort()
        .join(','),
    );
    expect(shapes.filter((shape) => shape === '4,4')).toHaveLength(5);
    expect(shapes.filter((shape) => shape === '3,3,3')).toHaveLength(5);
  });

  it('asks for each colour the same number of times', () => {
    for (const color of COLORS) {
      // Each colour sits in two of the five adjacent pairs and three of the five
      // adjacent triples, so the whole set is perfectly balanced.
      expect(ALL_NOBLES.filter((noble) => noble.requirement[color] === 4)).toHaveLength(2);
      expect(ALL_NOBLES.filter((noble) => noble.requirement[color] === 3)).toHaveLength(3);
    }
  });
});

describe('createBank', () => {
  it.each([
    [2, 4],
    [3, 5],
    [4, 7],
  ])('gives %i players %i gems per colour and always 5 gold', (playerCount, perColor) => {
    const bank = createBank(playerCount);
    for (const color of COLORS) expect(bank[color]).toBe(perColor);
    expect(bank.gold).toBe(5);
  });
});

describe('createGame', () => {
  it('rejects unsupported player counts', () => {
    expect(() => createGame(seeds(1))).toThrow(/player count/i);
    expect(() => createGame(seeds(5))).toThrow(/player count/i);
  });

  it('deals four face-up cards per tier and leaves the rest in the deck', () => {
    const game = newGame(3);
    expect(game.tableCards.tier1).toHaveLength(4);
    expect(game.tableCards.tier2).toHaveLength(4);
    expect(game.tableCards.tier3).toHaveLength(4);
    expect(game.decks.tier1).toHaveLength(36);
    expect(game.decks.tier2).toHaveLength(26);
    expect(game.decks.tier3).toHaveLength(16);
  });

  it('puts every card in exactly one place', () => {
    const game = newGame(4);
    const seen = [
      ...game.tableCards.tier1,
      ...game.tableCards.tier2,
      ...game.tableCards.tier3,
      ...game.decks.tier1,
      ...game.decks.tier2,
      ...game.decks.tier3,
    ];
    expect(seen).toHaveLength(90);
    expect(new Set(seen.map((card) => card.id)).size).toBe(90);
  });

  it.each([2, 3, 4])('deals playerCount + 1 nobles for %i players', (playerCount) => {
    const game = newGame(playerCount);
    expect(game.nobles).toHaveLength(nobleCountFor(playerCount));
    expect(new Set(game.nobles.map((noble) => noble.id)).size).toBe(game.nobles.length);
  });

  it('starts players empty and the game on player 0', () => {
    const game = newGame(2);
    for (const player of game.players) {
      expect(player.points).toBe(0);
      expect(player.cardsOwned).toEqual([]);
      expect(player.reservedCards).toEqual([]);
      expect(Object.values(player.tokens).every((n) => n === 0)).toBe(true);
    }
    expect(game.currentPlayerIndex).toBe(0);
    expect(game.turnCount).toBe(0);
    expect(game.status).toBe('playing');
    expect(game.winnerId).toBeNull();
    expect(game.finalRoundTriggered).toBe(false);
    expect(game.pendingDiscard).toBeNull();
  });

  it('is deterministic for a fixed seed and varies across seeds', () => {
    const a = newGame(2, 42);
    const b = newGame(2, 42);
    const c = newGame(2, 43);
    expect(a.tableCards.tier1.map((card) => card.id)).toEqual(
      b.tableCards.tier1.map((card) => card.id),
    );
    expect(a.decks.tier1.map((card) => card.id)).not.toEqual(c.decks.tier1.map((card) => card.id));
  });
});

describe('shuffle', () => {
  it('leaves the source array untouched and keeps every element', () => {
    const source = [1, 2, 3, 4, 5];
    const result = shuffle(source, seededRng(7));
    expect(source).toEqual([1, 2, 3, 4, 5]);
    expect([...result].sort()).toEqual(source);
  });
});
