import { COLORS, TOKEN_COLORS } from '../types.js';
import type { Color, Cost, GameState, Player, TokenColor, TokenPool } from '../types.js';

/**
 * Deep copy used by every action so callers never see their input mutated.
 * structuredClone is a Node 17+ global, but jest-environment-node does not always
 * expose it, so fall back to a JSON round-trip — GameState is plain JSON data.
 */
export function clone<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

export function emptyCost(): Cost {
  return { emerald: 0, sapphire: 0, ruby: 0, diamond: 0, onyx: 0 };
}

export function emptyTokenPool(): TokenPool {
  return { emerald: 0, sapphire: 0, ruby: 0, diamond: 0, onyx: 0, gold: 0 };
}

export function isColor(value: unknown): value is Color {
  return typeof value === 'string' && (COLORS as readonly string[]).includes(value);
}

export function isTokenColor(value: unknown): value is TokenColor {
  return typeof value === 'string' && (TOKEN_COLORS as readonly string[]).includes(value);
}

export function totalTokens(pool: TokenPool): number {
  return TOKEN_COLORS.reduce((sum, color) => sum + pool[color], 0);
}

/** How many cards of each colour a player owns — the discount applied to card costs. */
export function bonusesOf(player: Player): Cost {
  const bonuses = emptyCost();
  for (const card of player.cardsOwned) bonuses[card.bonus] += 1;
  return bonuses;
}

export function findPlayer(gameState: GameState, playerId: string): Player | undefined {
  return gameState.players.find((player) => player.id === playerId);
}

export function currentPlayer(gameState: GameState): Player | undefined {
  return gameState.players[gameState.currentPlayerIndex];
}
