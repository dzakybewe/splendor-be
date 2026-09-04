import type { Card, GameState, Noble, Player, TierKey, TokenPool } from '../types.js';
import { TIER_KEYS } from '../types.js';
import { CARDS_BY_TIER } from './cards.js';
import { ALL_NOBLES } from './nobles.js';
import {
  BANK_PER_PLAYER_COUNT,
  GOLD_COUNT,
  MAX_PLAYERS,
  MIN_PLAYERS,
  NOBLES_PER_PLAYER_OFFSET,
  TABLE_SLOTS,
} from './constants.js';
import { emptyTokenPool } from './utils.js';

export interface PlayerSeed {
  playerId: string;
  name: string;
}

/** Returns a float in [0, 1). Injectable so tests can pin the deal. */
export type Rng = () => number;

export interface CreateGameOptions {
  rng?: Rng;
}

/** Fisher-Yates on a copy; the source arrays stay untouched. */
export function shuffle<T>(items: readonly T[], rng: Rng = Math.random): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const a = result[i];
    const b = result[j];
    if (a === undefined || b === undefined) continue;
    result[i] = b;
    result[j] = a;
  }
  return result;
}

/** Bank contents for a given player count. Gold is fixed; gems scale with the table size. */
export function createBank(playerCount: number): TokenPool {
  const perColor = BANK_PER_PLAYER_COUNT[playerCount];
  if (perColor === undefined) {
    throw new Error(`Unsupported player count: ${playerCount}`);
  }
  return {
    emerald: perColor,
    sapphire: perColor,
    ruby: perColor,
    diamond: perColor,
    onyx: perColor,
    gold: GOLD_COUNT,
  };
}

function createPlayer(seed: PlayerSeed): Player {
  return {
    id: seed.playerId,
    name: seed.name,
    tokens: emptyTokenPool(),
    cardsOwned: [],
    reservedCards: [],
    points: 0,
  };
}

/** Nobles in play: one more than the number of players. */
export function nobleCountFor(playerCount: number): number {
  return playerCount + NOBLES_PER_PLAYER_OFFSET;
}

/** Build the starting GameState: shuffled decks, four face-up per tier, nobles dealt. */
export function createGame(seeds: PlayerSeed[], options: CreateGameOptions = {}): GameState {
  const playerCount = seeds.length;
  if (playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
    throw new Error(`Unsupported player count: ${playerCount}`);
  }
  const rng = options.rng ?? Math.random;

  const tableCards = {} as Record<TierKey, Card[]>;
  const decks = {} as Record<TierKey, Card[]>;
  for (const tierKey of TIER_KEYS) {
    const shuffled = shuffle(CARDS_BY_TIER[tierKey], rng);
    tableCards[tierKey] = shuffled.slice(0, TABLE_SLOTS);
    decks[tierKey] = shuffled.slice(TABLE_SLOTS);
  }

  const nobles: Noble[] = shuffle(ALL_NOBLES, rng).slice(0, nobleCountFor(playerCount));

  return {
    players: seeds.map(createPlayer),
    bank: createBank(playerCount),
    tableCards,
    decks,
    nobles,
    currentPlayerIndex: 0,
    turnCount: 0,
    status: 'playing',
    winnerId: null,
    finalRoundTriggered: false,
    finalRoundStartIndex: null,
    pendingDiscard: null,
  };
}
