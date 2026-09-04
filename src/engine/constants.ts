import type { Tier, TierKey } from '../types.js';

/** Points that trigger the final round. */
export const WINNING_POINTS = 15;

/** Tokens a player may hold at the end of their turn. */
export const MAX_TOKENS = 10;

/** Cards a player may hold in reserve. */
export const MAX_RESERVED = 3;

/** Face-up cards per tier. */
export const TABLE_SLOTS = 4;

/** A "take two of the same colour" needs at least this many left in the bank. */
export const TAKE_TWO_MIN_IN_BANK = 4;

/** Tokens taken by a "take three different colours". */
export const TAKE_THREE_COUNT = 3;

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;

/** Gold in the bank, independent of player count. */
export const GOLD_COUNT = 5;

/** Gem tokens per colour, keyed by player count. */
export const BANK_PER_PLAYER_COUNT: Record<number, number> = {
  2: 4,
  3: 5,
  4: 7,
};

/** Nobles dealt = player count + this. */
export const NOBLES_PER_PLAYER_OFFSET = 1;

export const NOBLE_POINTS = 3;

export const TIER_OF: Record<TierKey, Tier> = { tier1: 1, tier2: 2, tier3: 3 };
export const KEY_OF_TIER: Record<Tier, TierKey> = { 1: 'tier1', 2: 'tier2', 3: 'tier3' };
