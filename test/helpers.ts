import type { Card, Color, Cost, GameState, Noble, Player, TokenPool } from '../src/types.js';
import { createGame } from '../src/engine/gameState.js';
import type { PlayerSeed, Rng } from '../src/engine/gameState.js';
import { emptyCost, emptyTokenPool } from '../src/engine/utils.js';

/** Deterministic RNG (mulberry32) so a failing test always fails the same way. */
export function seededRng(seed = 1): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seeds(count: number): PlayerSeed[] {
  return Array.from({ length: count }, (_, i) => ({
    playerId: `p${i + 1}`,
    name: `Player ${i + 1}`,
  }));
}

export function newGame(playerCount = 2, seed = 1): GameState {
  return createGame(seeds(playerCount), { rng: seededRng(seed) });
}

export function cost(partial: Partial<Cost>): Cost {
  return { ...emptyCost(), ...partial };
}

export function tokens(partial: Partial<TokenPool>): TokenPool {
  return { ...emptyTokenPool(), ...partial };
}

export function card(overrides: Partial<Card> & { id: string; bonus: Color }): Card {
  return {
    tier: 1,
    points: 0,
    cost: emptyCost(),
    ...overrides,
  };
}

export function noble(id: string, requirement: Partial<Cost>): Noble {
  return { id, requirement: cost(requirement), points: 3 };
}

/** Fake owned cards granting `count` bonuses of a colour, for discount tests. */
export function bonusCards(color: Color, count: number): Card[] {
  return Array.from({ length: count }, (_, i) => card({ id: `bonus-${color}-${i}`, bonus: color }));
}

export function playerAt(gameState: GameState, index: number): Player {
  const player = gameState.players[index];
  if (!player) throw new Error(`no player at index ${index}`);
  return player;
}
