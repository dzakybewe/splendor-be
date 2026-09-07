import type {
  ActionResult,
  BuyCardPayload,
  Card,
  DiscardExcessTokensPayload,
  GameState,
  Player,
  ReserveCardPayload,
  TakeThreeDifferentPayload,
  TakeTwoSamePayload,
  Tier,
  TierKey,
  TokenColor,
} from '../types.js';
import { COLORS, TIER_KEYS } from '../types.js';
import {
  KEY_OF_TIER,
  MAX_RESERVED,
  MAX_TOKENS,
  TAKE_THREE_COUNT,
  TAKE_TWO_MIN_IN_BANK,
} from './constants.js';
import { ERRORS } from './errors.js';
import {
  bonusesOf,
  clone,
  currentPlayer,
  isColor,
  isTokenColor,
  totalTokens,
} from './utils.js';

/**
 * Every action here follows the same contract: take the current GameState, return a new
 * one, never mutate the input. The acting player is always `currentPlayerIndex` — turn
 * ownership is checked upstream by `validateAction`.
 */

function fail(error: string): ActionResult {
  return { success: false, error };
}

/**
 * Take one token each of up to three different colours. Gold cannot be taken this way.
 *
 * Deviates from the printed rule (which requires exactly three unless the bank is
 * scarce): the player may choose to take 1, 2, or 3 distinct colours regardless of
 * what else remains in the bank.
 */
export function takeThreeDifferentTokens(
  gameState: GameState,
  payload: TakeThreeDifferentPayload,
): ActionResult {
  const colors = payload?.colors;
  if (!Array.isArray(colors) || colors.length < 1 || colors.length > TAKE_THREE_COUNT) {
    return fail(ERRORS.NEED_THREE_DISTINCT_COLORS);
  }
  if (new Set(colors).size !== colors.length) {
    return fail(ERRORS.NEED_THREE_DISTINCT_COLORS);
  }
  // isColor rejects gold, which is only ever obtained by reserving.
  if (!colors.every(isColor)) return fail(ERRORS.INVALID_COLOR);

  const next = clone(gameState);
  const player = currentPlayer(next);
  if (!player) return fail(ERRORS.UNKNOWN_PLAYER);

  for (const color of colors) {
    if (next.bank[color] < 1) return fail(ERRORS.COLOR_NOT_AVAILABLE);
  }
  for (const color of colors) {
    next.bank[color] -= 1;
    player.tokens[color] += 1;
  }

  return { success: true, gameState: next };
}

/** Take two tokens of one colour. Legal only while at least four of it remain. */
export function takeTwoSameTokens(
  gameState: GameState,
  payload: TakeTwoSamePayload,
): ActionResult {
  const color = payload?.color;
  if (!isColor(color)) return fail(ERRORS.INVALID_COLOR);
  if (gameState.bank[color] < TAKE_TWO_MIN_IN_BANK) {
    return fail(ERRORS.NOT_ENOUGH_IN_BANK_FOR_TWO);
  }

  const next = clone(gameState);
  const player = currentPlayer(next);
  if (!player) return fail(ERRORS.UNKNOWN_PLAYER);

  next.bank[color] -= 2;
  player.tokens[color] += 2;

  return { success: true, gameState: next };
}

/**
 * Hand tokens back until the player is at the limit. Only accepted while a discard is
 * pending, and the amount must land exactly on MAX_TOKENS — no partial discards, so the
 * turn cannot stall halfway.
 */
export function discardExcessTokens(
  gameState: GameState,
  payload: DiscardExcessTokensPayload,
): ActionResult {
  const pending = gameState.pendingDiscard;
  if (!pending) return fail(ERRORS.NO_DISCARD_PENDING);

  const requested = payload?.tokensToDiscard;
  if (!requested || typeof requested !== 'object') return fail(ERRORS.DISCARD_WRONG_AMOUNT);

  const entries: [TokenColor, number][] = [];
  for (const [key, value] of Object.entries(requested)) {
    if (value === undefined || value === 0) continue;
    if (!isTokenColor(key)) return fail(ERRORS.INVALID_COLOR);
    if (!Number.isInteger(value) || value < 0) return fail(ERRORS.DISCARD_WRONG_AMOUNT);
    entries.push([key, value]);
  }

  const discarded = entries.reduce((sum, [, amount]) => sum + amount, 0);
  if (discarded !== pending.excess) return fail(ERRORS.DISCARD_WRONG_AMOUNT);

  const next = clone(gameState);
  const player = next.players.find((candidate) => candidate.id === pending.playerId);
  if (!player) return fail(ERRORS.UNKNOWN_PLAYER);

  for (const [color, amount] of entries) {
    if (player.tokens[color] < amount) return fail(ERRORS.DISCARD_TOKENS_NOT_HELD);
  }
  for (const [color, amount] of entries) {
    player.tokens[color] -= amount;
    next.bank[color] += amount;
  }

  if (totalTokens(player.tokens) > MAX_TOKENS) return fail(ERRORS.DISCARD_WRONG_AMOUNT);
  next.pendingDiscard = null;

  return { success: true, gameState: next };
}

// ---------------------------------------------------------------------------
// Card actions
// ---------------------------------------------------------------------------

function tierKeyOf(tier: unknown): TierKey | null {
  if (tier !== 1 && tier !== 2 && tier !== 3) return null;
  return KEY_OF_TIER[tier as Tier];
}

/** Where a face-up card is sitting, or null if it is not on the table. */
function findOnTable(
  gameState: GameState,
  cardId: string,
): { tierKey: TierKey; index: number } | null {
  for (const tierKey of TIER_KEYS) {
    const index = gameState.tableCards[tierKey].findIndex((card) => card.id === cardId);
    if (index !== -1) return { tierKey, index };
  }
  return null;
}

/**
 * Take a card out of a face-up slot and turn the next deck card into its replacement.
 * Once the deck is exhausted the row simply gets shorter — that is the printed rule.
 */
function takeFromTable(gameState: GameState, tierKey: TierKey, index: number): Card | null {
  const [taken] = gameState.tableCards[tierKey].splice(index, 1);
  if (!taken) return null;

  const replacement = gameState.decks[tierKey].shift();
  if (replacement) gameState.tableCards[tierKey].splice(index, 0, replacement);
  return taken;
}

/**
 * Reserve a face-up card, or the unseen top card of a tier, and take a gold token.
 *
 * An empty gold pile does not block the reservation — the player simply gets no gold,
 * which is the printed rule.
 */
export function reserveCard(gameState: GameState, payload: ReserveCardPayload): ActionResult {
  const next = clone(gameState);
  const player = currentPlayer(next);
  if (!player) return fail(ERRORS.UNKNOWN_PLAYER);
  if (player.reservedCards.length >= MAX_RESERVED) return fail(ERRORS.RESERVE_LIMIT_REACHED);

  let card: Card | null | undefined;

  if (payload && 'fromDeck' in payload && payload.fromDeck === true) {
    const tierKey = tierKeyOf(payload.tier);
    if (!tierKey) return fail(ERRORS.INVALID_TIER);
    if (next.decks[tierKey].length === 0) return fail(ERRORS.DECK_EMPTY);
    card = next.decks[tierKey].shift();
  } else {
    const cardId = payload && 'cardId' in payload ? payload.cardId : undefined;
    if (typeof cardId !== 'string') return fail(ERRORS.CARD_NOT_FOUND);
    const location = findOnTable(next, cardId);
    if (!location) return fail(ERRORS.CARD_NOT_ON_TABLE);
    card = takeFromTable(next, location.tierKey, location.index);
  }

  if (!card) return fail(ERRORS.CARD_NOT_FOUND);
  player.reservedCards.push(card);

  if (next.bank.gold > 0) {
    next.bank.gold -= 1;
    player.tokens.gold += 1;
  }

  return { success: true, gameState: next };
}

/** What a player must actually pay for a card, after their card bonuses discount it. */
export function paymentFor(
  player: Player,
  card: Card,
): { tokens: Partial<Record<TokenColor, number>>; gold: number } | null {
  const bonuses = bonusesOf(player);
  const tokens: Partial<Record<TokenColor, number>> = {};
  let gold = 0;

  for (const color of COLORS) {
    const owed = Math.max(0, card.cost[color] - bonuses[color]);
    if (owed === 0) continue;
    const paidWithGems = Math.min(owed, player.tokens[color]);
    if (paidWithGems > 0) tokens[color] = paidWithGems;
    // Gold is a wildcard, covering whatever the gem tokens could not.
    gold += owed - paidWithGems;
  }

  if (gold > player.tokens.gold) return null;
  if (gold > 0) tokens.gold = gold;
  return { tokens, gold };
}

/** Buy a card from the table or from your own reserve, paying bonuses-adjusted cost. */
export function buyCard(gameState: GameState, payload: BuyCardPayload): ActionResult {
  const cardId = payload?.cardId;
  if (typeof cardId !== 'string') return fail(ERRORS.CARD_NOT_FOUND);

  const next = clone(gameState);
  const player = currentPlayer(next);
  if (!player) return fail(ERRORS.UNKNOWN_PLAYER);

  const fromReserved = payload.fromReserved === true;
  const reservedIndex = fromReserved
    ? player.reservedCards.findIndex((candidate) => candidate.id === cardId)
    : -1;
  const location = fromReserved ? null : findOnTable(next, cardId);

  let card: Card | undefined;
  if (fromReserved) {
    if (reservedIndex === -1) return fail(ERRORS.CARD_NOT_RESERVED);
    card = player.reservedCards[reservedIndex];
  } else {
    if (!location) return fail(ERRORS.CARD_NOT_ON_TABLE);
    card = next.tableCards[location.tierKey][location.index];
  }
  if (!card) return fail(ERRORS.CARD_NOT_FOUND);

  const payment = paymentFor(player, card);
  if (!payment) return fail(ERRORS.INSUFFICIENT_RESOURCES);

  for (const [color, amount] of Object.entries(payment.tokens)) {
    if (!isTokenColor(color) || amount === undefined) continue;
    player.tokens[color] -= amount;
    next.bank[color] += amount;
  }

  if (location) {
    takeFromTable(next, location.tierKey, location.index);
  } else {
    player.reservedCards.splice(reservedIndex, 1);
  }

  player.cardsOwned.push(card);
  player.points += card.points;

  return { success: true, gameState: next };
}

/** Total tokens held, used by the pipeline to decide whether a discard is owed. */
export function heldTokens(gameState: GameState, playerId: string): number {
  const player = gameState.players.find((candidate) => candidate.id === playerId);
  return player ? totalTokens(player.tokens) : 0;
}
