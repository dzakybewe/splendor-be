import { discardExcessTokens } from '../src/engine/actions.js';
import {
  applyAction,
  checkNobleVisit,
  checkWinCondition,
  determineWinner,
} from '../src/engine/rules.js';
import { ERRORS } from '../src/engine/errors.js';
import { WINNING_POINTS } from '../src/engine/constants.js';
import { bonusCards, card, cost, newGame, noble, playerAt, tokens } from './helpers.js';

describe('checkNobleVisit', () => {
  it('awards a noble the moment its requirement is met', () => {
    const game = newGame(2);
    game.nobles = [noble('n1', { ruby: 3, onyx: 3 })];
    playerAt(game, 0).cardsOwned = [...bonusCards('ruby', 3), ...bonusCards('onyx', 3)];

    const after = checkNobleVisit(game, 'p1');
    expect(after.nobles).toHaveLength(0);
    expect(playerAt(after, 0).points).toBe(3);
  });

  it('leaves the noble alone when the player is one bonus short', () => {
    const game = newGame(2);
    game.nobles = [noble('n1', { ruby: 3, onyx: 3 })];
    playerAt(game, 0).cardsOwned = [...bonusCards('ruby', 3), ...bonusCards('onyx', 2)];

    const after = checkNobleVisit(game, 'p1');
    expect(after.nobles).toHaveLength(1);
    expect(playerAt(after, 0).points).toBe(0);
  });

  it('awards only the first qualifying noble when several qualify at once', () => {
    const game = newGame(2);
    game.nobles = [noble('first', { ruby: 3, onyx: 3 }), noble('second', { ruby: 3, onyx: 3 })];
    playerAt(game, 0).cardsOwned = [...bonusCards('ruby', 3), ...bonusCards('onyx', 3)];

    const after = checkNobleVisit(game, 'p1');
    expect(after.nobles.map((n) => n.id)).toEqual(['second']);
    expect(playerAt(after, 0).points).toBe(3);
  });

  it('arrives automatically at the end of an action that completes the requirement', () => {
    const game = newGame(2);
    game.nobles = [noble('n1', { ruby: 3 })];
    const target = card({ id: 'target', bonus: 'ruby', cost: cost({ onyx: 1 }) });
    game.tableCards.tier1[0] = target;

    const player = playerAt(game, 0);
    player.cardsOwned = bonusCards('ruby', 2); // the purchase makes it three
    player.tokens = tokens({ onyx: 1 });

    const result = applyAction(game, 'p1', { type: 'buy_card', cardId: 'target' });
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.gameState.nobles).toHaveLength(0);
    expect(playerAt(result.gameState, 0).points).toBe(3);
  });

  it('does not mutate the state it was given', () => {
    const game = newGame(2);
    game.nobles = [noble('n1', { ruby: 3 })];
    playerAt(game, 0).cardsOwned = bonusCards('ruby', 3);
    const before = JSON.stringify(game);

    checkNobleVisit(game, 'p1');
    expect(JSON.stringify(game)).toBe(before);
  });
});

describe('the >10 token discard', () => {
  /** Ten tokens in hand and a bank able to hand over three more. */
  function gameAtTenTokens() {
    const game = newGame(3); // 3-player bank has 5 per colour
    playerAt(game, 0).tokens = tokens({ ruby: 4, onyx: 3, diamond: 3 });
    return game;
  }

  it('blocks the turn instead of advancing it', () => {
    const game = gameAtTenTokens();
    const result = applyAction(game, 'p1', {
      type: 'take_three_different',
      colors: ['emerald', 'sapphire', 'diamond'],
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.gameState.pendingDiscard).toEqual({ playerId: 'p1', excess: 3 });
    expect(result.gameState.currentPlayerIndex).toBe(0);
    expect(result.gameState.turnCount).toBe(0);
  });

  it('refuses every other action from that player until they discard', () => {
    const game = gameAtTenTokens();
    game.pendingDiscard = { playerId: 'p1', excess: 3 };

    const result = applyAction(game, 'p1', { type: 'take_two_same', color: 'emerald' });
    expect(result).toEqual({ success: false, error: ERRORS.DISCARD_REQUIRED });
  });

  it('refuses actions from everyone else too', () => {
    const game = gameAtTenTokens();
    game.pendingDiscard = { playerId: 'p1', excess: 3 };

    const result = applyAction(game, 'p2', { type: 'take_two_same', color: 'emerald' });
    expect(result).toEqual({ success: false, error: ERRORS.DISCARD_REQUIRED });
  });

  it('clears the block and advances the turn once the right amount is handed back', () => {
    const game = gameAtTenTokens();
    game.players[0]!.tokens = tokens({ ruby: 5, onyx: 4, diamond: 4 });
    game.pendingDiscard = { playerId: 'p1', excess: 3 };

    const result = applyAction(game, 'p1', {
      type: 'discard_tokens',
      tokensToDiscard: { ruby: 2, onyx: 1 },
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    const player = playerAt(result.gameState, 0);
    expect(player.tokens.ruby).toBe(3);
    expect(player.tokens.onyx).toBe(3);
    expect(result.gameState.pendingDiscard).toBeNull();
    expect(result.gameState.currentPlayerIndex).toBe(1);
    // Discarded tokens go back to the bank, which held 5 of each at setup.
    expect(result.gameState.bank.ruby).toBe(7);
  });

  it('rejects a discard of the wrong size', () => {
    const game = gameAtTenTokens();
    game.players[0]!.tokens = tokens({ ruby: 5, onyx: 4, diamond: 4 });
    game.pendingDiscard = { playerId: 'p1', excess: 3 };

    expect(
      discardExcessTokens(game, { tokensToDiscard: { ruby: 2 } }).error,
    ).toBe(ERRORS.DISCARD_WRONG_AMOUNT);
    expect(
      discardExcessTokens(game, { tokensToDiscard: { ruby: 4 } }).error,
    ).toBe(ERRORS.DISCARD_WRONG_AMOUNT);
  });

  it('rejects discarding tokens the player does not hold', () => {
    const game = gameAtTenTokens();
    game.players[0]!.tokens = tokens({ ruby: 5, onyx: 4, diamond: 4 });
    game.pendingDiscard = { playerId: 'p1', excess: 3 };

    const result = discardExcessTokens(game, { tokensToDiscard: { emerald: 3 } });
    expect(result.error).toBe(ERRORS.DISCARD_TOKENS_NOT_HELD);
  });

  it('rejects a discard when none is pending', () => {
    const game = gameAtTenTokens();
    expect(discardExcessTokens(game, { tokensToDiscard: { ruby: 1 } })).toEqual({
      success: false,
      error: ERRORS.NO_DISCARD_PENDING,
    });
  });

  it('also triggers on the gold from a reservation', () => {
    const game = newGame(3);
    playerAt(game, 0).tokens = tokens({ ruby: 5, onyx: 5 });

    const result = applyAction(game, 'p1', {
      type: 'reserve_card',
      cardId: game.tableCards.tier1[0]?.id ?? '',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.gameState.pendingDiscard).toEqual({ playerId: 'p1', excess: 1 });
  });
});

describe('checkWinCondition', () => {
  it('arms the final round rather than ending the game on the spot', () => {
    const game = newGame(3);
    playerAt(game, 0).points = WINNING_POINTS;

    const after = checkWinCondition(game);
    expect(after.finalRoundTriggered).toBe(true);
    expect(after.finalRoundStartIndex).toBe(0);
    expect(after.status).toBe('playing');
    expect(after.winnerId).toBeNull();
  });

  it('does nothing below the winning score', () => {
    const game = newGame(3);
    playerAt(game, 0).points = WINNING_POINTS - 1;
    expect(checkWinCondition(game).finalRoundTriggered).toBe(false);
  });
});

describe('finishing the game', () => {
  /** A cheap 1-point card in slot 0 that the current player can always afford. */
  function stageCheapBuy(game: ReturnType<typeof newGame>, playerIndex: number, points = 1) {
    const target = card({
      id: `buy-${playerIndex}-${points}`,
      bonus: 'onyx',
      points,
      cost: cost({ ruby: 1 }),
    });
    game.tableCards.tier1[0] = target;
    playerAt(game, playerIndex).tokens = tokens({ ruby: 1 });
    return target.id;
  }

  it('lets the rest of the round play out before finishing', () => {
    const game = newGame(3);
    playerAt(game, 0).points = WINNING_POINTS - 1;

    // Player 1 crosses the line.
    let state = game;
    const first = applyAction(state, 'p1', { type: 'buy_card', cardId: stageCheapBuy(state, 0) });
    expect(first.success).toBe(true);
    if (!first.success) return;
    state = first.gameState;

    expect(playerAt(state, 0).points).toBe(WINNING_POINTS);
    expect(state.finalRoundTriggered).toBe(true);
    expect(state.status).toBe('playing');
    expect(state.currentPlayerIndex).toBe(1);

    // Players 2 and 3 still get their turn.
    const second = applyAction(state, 'p2', {
      type: 'take_three_different',
      colors: ['emerald', 'sapphire', 'diamond'],
    });
    expect(second.success).toBe(true);
    if (!second.success) return;
    state = second.gameState;
    expect(state.status).toBe('playing');
    expect(state.currentPlayerIndex).toBe(2);

    const third = applyAction(state, 'p3', {
      type: 'take_three_different',
      colors: ['emerald', 'sapphire', 'diamond'],
    });
    expect(third.success).toBe(true);
    if (!third.success) return;
    state = third.gameState;

    // The round is back at seat 0, so the game closes.
    expect(state.status).toBe('finished');
    expect(state.winnerId).toBe('p1');
  });

  it('finishes immediately when the last seat triggers it', () => {
    const game = newGame(2);
    game.currentPlayerIndex = 1;
    playerAt(game, 1).points = WINNING_POINTS - 1;

    const result = applyAction(game, 'p2', { type: 'buy_card', cardId: stageCheapBuy(game, 1) });
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.gameState.status).toBe('finished');
    expect(result.gameState.winnerId).toBe('p2');
  });

  it('refuses any further action once finished', () => {
    const game = newGame(2);
    game.status = 'finished';
    const result = applyAction(game, 'p1', { type: 'take_two_same', color: 'ruby' });
    expect(result).toEqual({ success: false, error: ERRORS.GAME_NOT_PLAYING });
  });
});

describe('determineWinner', () => {
  it('picks the highest score', () => {
    const game = newGame(3);
    playerAt(game, 0).points = 15;
    playerAt(game, 1).points = 17;
    playerAt(game, 2).points = 16;
    expect(determineWinner(game)).toBe('p2');
  });

  it('breaks a tie on the fewest development cards', () => {
    const game = newGame(2);
    playerAt(game, 0).points = 15;
    playerAt(game, 0).cardsOwned = bonusCards('ruby', 9);
    playerAt(game, 1).points = 15;
    playerAt(game, 1).cardsOwned = bonusCards('onyx', 7);

    expect(determineWinner(game)).toBe('p2');
  });

  it('keeps the earlier seat when points and card counts are identical', () => {
    const game = newGame(2);
    playerAt(game, 0).points = 15;
    playerAt(game, 0).cardsOwned = bonusCards('ruby', 8);
    playerAt(game, 1).points = 15;
    playerAt(game, 1).cardsOwned = bonusCards('onyx', 8);

    expect(determineWinner(game)).toBe('p1');
  });
});
