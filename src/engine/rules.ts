import { randomUUID } from 'node:crypto';
import type { ActionResult, GameState, LogEntry, Player, PlayerAction } from '../types.js';
import {
  buyCard,
  discardExcessTokens,
  reserveCard,
  takeThreeDifferentTokens,
  takeTwoSameTokens,
} from './actions.js';
import { COLORS } from '../types.js';
import { MAX_TOKENS, WINNING_POINTS } from './constants.js';
import { ERRORS } from './errors.js';
import { bonusesOf, clone, currentPlayer, findPlayer, totalTokens } from './utils.js';

function fail(error: string): ActionResult {
  return { success: false, error };
}

/**
 * Turn a just-applied action into its log entry. Reads card details back out of
 * `gameState` (the state *after* the action ran) rather than re-deriving them, since
 * the action already resolved which card was reserved or bought.
 */
function buildLogEntry(
  gameStateBefore: GameState,
  gameStateAfter: GameState,
  playerId: string,
  action: PlayerAction,
): LogEntry | null {
  const base = { id: randomUUID(), timestamp: Date.now() };
  const player = findPlayer(gameStateAfter, playerId);
  if (!player) return null;

  switch (action.type) {
    case 'take_three_different':
      return { ...base, type: 'take_three_different', playerId, colors: [...action.colors] };
    case 'take_two_same':
      return { ...base, type: 'take_two_same', playerId, color: action.color, count: 2 };
    case 'reserve_card': {
      const card = player.reservedCards[player.reservedCards.length - 1];
      if (!card) return null;
      const playerBefore = findPlayer(gameStateBefore, playerId);
      const goldBefore = playerBefore?.tokens.gold ?? 0;
      return {
        ...base,
        type: 'reserve_card',
        playerId,
        card,
        tookGold: player.tokens.gold > goldBefore,
        fromDeck: 'fromDeck' in action && action.fromDeck === true,
      };
    }
    case 'buy_card': {
      const card = player.cardsOwned[player.cardsOwned.length - 1];
      if (!card) return null;
      return {
        ...base,
        type: 'buy_card',
        playerId,
        card,
        fromReserved: action.fromReserved === true,
      };
    }
    case 'discard_tokens':
      return { ...base, type: 'discard_tokens', playerId, tokens: action.tokensToDiscard };
    default:
      return null;
  }
}

function appendLog(gameState: GameState, entry: LogEntry | null): GameState {
  if (!entry) return gameState;
  const next = clone(gameState);
  next.log.push(entry);
  return next;
}

/**
 * Gate an action before it runs: right phase, right player, and — while a discard is
 * owed — nothing but the discard.
 *
 * Deviates from the brief's `validateAction(gameState, action)` by taking the acting
 * player's id: without it the function cannot actually check whose turn it is.
 */
export function validateAction(
  gameState: GameState,
  playerId: string,
  action: PlayerAction,
): { ok: true } | { ok: false; error: string } {
  if (gameState.status !== 'playing') return { ok: false, error: ERRORS.GAME_NOT_PLAYING };

  const player = findPlayer(gameState, playerId);
  if (!player) return { ok: false, error: ERRORS.UNKNOWN_PLAYER };

  const pending = gameState.pendingDiscard;
  if (pending) {
    // The game is frozen on one player's discard; nobody else acts, and that player
    // may only discard.
    if (pending.playerId !== playerId) return { ok: false, error: ERRORS.DISCARD_REQUIRED };
    if (action.type !== 'discard_tokens') return { ok: false, error: ERRORS.DISCARD_REQUIRED };
    return { ok: true };
  }

  if (action.type === 'discard_tokens') return { ok: false, error: ERRORS.NO_DISCARD_PENDING };

  const active = currentPlayer(gameState);
  if (!active || active.id !== playerId) return { ok: false, error: ERRORS.NOT_YOUR_TURN };

  return { ok: true };
}

/** Move to the next seat and count the turn. Pure. */
export function advanceTurn(gameState: GameState): GameState {
  const next = clone(gameState);
  next.currentPlayerIndex = (next.currentPlayerIndex + 1) % next.players.length;
  next.turnCount += 1;
  return next;
}

/**
 * Award a noble to the player who just acted, if they now qualify.
 *
 * Splendor lets a player choose when several nobles qualify at once. That would need an
 * extra client round-trip and a new event, so by decision the server awards the first
 * qualifying noble in table order — deterministic, and the brief's `checkNobleVisit`
 * stays fully automatic.
 */
export function checkNobleVisit(gameState: GameState, playerId: string): GameState {
  const player = findPlayer(gameState, playerId);
  if (!player) return gameState;

  const bonuses = bonusesOf(player);
  const index = gameState.nobles.findIndex((noble) =>
    COLORS.every((color) => bonuses[color] >= noble.requirement[color]),
  );
  if (index === -1) return gameState;

  const next = clone(gameState);
  const [visiting] = next.nobles.splice(index, 1);
  if (!visiting) return gameState;

  const owner = findPlayer(next, playerId);
  if (!owner) return gameState;
  owner.points += visiting.points;

  return next;
}

/** Most points wins; ties go to the player who bought fewer development cards. */
export function determineWinner(gameState: GameState): string | null {
  let best: Player | undefined;
  for (const player of gameState.players) {
    if (!best) {
      best = player;
      continue;
    }
    if (player.points > best.points) {
      best = player;
    } else if (player.points === best.points && player.cardsOwned.length < best.cardsOwned.length) {
      best = player;
    }
  }
  return best?.id ?? null;
}

/**
 * Called once per completed turn, before the turn advances.
 *
 * Reaching the winning score does not end the game on the spot: it arms the final round
 * so every player ends up with the same number of turns. `finalRoundStartIndex` records
 * the seat the round has to come back round to.
 */
export function checkWinCondition(gameState: GameState): GameState {
  if (gameState.status !== 'playing') return gameState;
  if (gameState.finalRoundTriggered) return gameState;
  if (!gameState.players.some((player) => player.points >= WINNING_POINTS)) return gameState;

  const next = clone(gameState);
  next.finalRoundTriggered = true;
  // Play always starts at seat 0, so a round is complete when the turn returns there.
  next.finalRoundStartIndex = 0;
  return next;
}

/** Close the game out if the armed final round has come back around. */
function finishIfRoundComplete(gameState: GameState): GameState {
  if (!gameState.finalRoundTriggered) return gameState;
  if (gameState.currentPlayerIndex !== (gameState.finalRoundStartIndex ?? 0)) return gameState;

  const next = clone(gameState);
  next.status = 'finished';
  next.winnerId = determineWinner(next);
  return next;
}

function dispatch(gameState: GameState, action: PlayerAction): ActionResult {
  switch (action.type) {
    case 'take_three_different':
      return takeThreeDifferentTokens(gameState, action);
    case 'take_two_same':
      return takeTwoSameTokens(gameState, action);
    case 'reserve_card':
      return reserveCard(gameState, action);
    case 'buy_card':
      return buyCard(gameState, action);
    case 'discard_tokens':
      return discardExcessTokens(gameState, action);
    default:
      return fail(ERRORS.UNKNOWN_ACTION);
  }
}

/**
 * Run one player action through the full turn pipeline:
 * validate -> apply -> noble visit -> discard-or-advance -> win check.
 *
 * Holding more than MAX_TOKENS blocks the turn: `pendingDiscard` is set and the turn
 * does not advance until the player hands tokens back.
 */
export function applyAction(
  gameState: GameState,
  playerId: string,
  action: PlayerAction,
): ActionResult {
  const gate = validateAction(gameState, playerId, action);
  if (!gate.ok) return fail(gate.error);

  const result = dispatch(gameState, action);
  if (!result.success) return result;

  let next = appendLog(
    result.gameState,
    buildLogEntry(gameState, result.gameState, playerId, action),
  );

  const nobleCountBefore = next.nobles.length;
  next = checkNobleVisit(next, playerId);
  if (next.nobles.length < nobleCountBefore) {
    const visited = gameState.nobles.find(
      (noble) => !next.nobles.some((remaining) => remaining.id === noble.id),
    );
    if (visited) {
      next = appendLog(next, {
        id: randomUUID(),
        timestamp: Date.now(),
        type: 'noble_visit',
        playerId,
        noble: visited,
      });
    }
  }

  const actor = findPlayer(next, playerId);
  const held = actor ? totalTokens(actor.tokens) : 0;
  if (held > MAX_TOKENS) {
    next = clone(next);
    next.pendingDiscard = { playerId, excess: held - MAX_TOKENS };
    // Turn stays with this player until they discard.
    return { success: true, gameState: next };
  }

  next = checkWinCondition(next);
  next = advanceTurn(next);
  const wasPlaying = next.status === 'playing';
  next = finishIfRoundComplete(next);
  if (wasPlaying && next.status === 'finished') {
    next = appendLog(next, {
      id: randomUUID(),
      timestamp: Date.now(),
      type: 'game_over',
      winnerId: next.winnerId,
    });
  }

  return { success: true, gameState: next };
}
