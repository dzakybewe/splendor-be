import { takeThreeDifferentTokens, takeTwoSameTokens } from '../src/engine/actions.js';
import { advanceTurn, applyAction, validateAction } from '../src/engine/rules.js';
import { ERRORS } from '../src/engine/errors.js';
import { newGame, playerAt } from './helpers.js';

describe('takeThreeDifferentTokens', () => {
  it('moves one token of each colour from the bank to the current player', () => {
    const game = newGame(2);
    const result = takeThreeDifferentTokens(game, {
      colors: ['emerald', 'ruby', 'onyx'],
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    const player = playerAt(result.gameState, 0);
    expect(player.tokens.emerald).toBe(1);
    expect(player.tokens.ruby).toBe(1);
    expect(player.tokens.onyx).toBe(1);
    expect(player.tokens.sapphire).toBe(0);
    expect(result.gameState.bank.emerald).toBe(3);
    expect(result.gameState.bank.ruby).toBe(3);
    expect(result.gameState.bank.onyx).toBe(3);
    expect(result.gameState.bank.diamond).toBe(4);
  });

  it('does not mutate the state it was given', () => {
    const game = newGame(2);
    const before = JSON.stringify(game);
    takeThreeDifferentTokens(game, { colors: ['emerald', 'ruby', 'onyx'] });
    expect(JSON.stringify(game)).toBe(before);
  });

  it('rejects repeated colours', () => {
    const game = newGame(2);
    const result = takeThreeDifferentTokens(game, {
      colors: ['emerald', 'emerald', 'onyx'],
    });
    expect(result).toEqual({ success: false, error: ERRORS.NEED_THREE_DISTINCT_COLORS });
  });

  it('allows taking fewer than three distinct colours', () => {
    const game = newGame(2);
    const result = takeThreeDifferentTokens(game, { colors: ['emerald', 'ruby'] });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const player = playerAt(result.gameState, 0);
    expect(player.tokens.emerald).toBe(1);
    expect(player.tokens.ruby).toBe(1);
    expect(player.tokens.onyx).toBe(0);
  });

  it('rejects more than three colours', () => {
    const game = newGame(2);
    expect(
      takeThreeDifferentTokens(game, {
        colors: ['emerald', 'ruby', 'onyx', 'diamond'],
      }).error,
    ).toBe(ERRORS.NEED_THREE_DISTINCT_COLORS);
  });

  it('rejects an empty colour list', () => {
    const game = newGame(2);
    expect(takeThreeDifferentTokens(game, { colors: [] }).error).toBe(
      ERRORS.NEED_THREE_DISTINCT_COLORS,
    );
  });

  it('rejects gold and unknown colours', () => {
    const game = newGame(2);
    const result = takeThreeDifferentTokens(game, {
      // gold is only ever obtained by reserving, never taken directly
      colors: ['emerald', 'ruby', 'gold'] as never,
    });
    expect(result.error).toBe(ERRORS.INVALID_COLOR);
  });

  it('rejects the whole action when any one colour is exhausted', () => {
    const game = newGame(2);
    game.bank.onyx = 0;

    const result = takeThreeDifferentTokens(game, {
      colors: ['emerald', 'ruby', 'onyx'],
    });
    expect(result.error).toBe(ERRORS.COLOR_NOT_AVAILABLE);
    // and nothing partial happened
    expect(game.bank.emerald).toBe(4);
    expect(playerAt(game, 0).tokens.emerald).toBe(0);
  });
});

describe('takeTwoSameTokens', () => {
  it('takes two of a colour that has at least four left', () => {
    const game = newGame(2); // 2-player bank starts at exactly 4 per colour
    const result = takeTwoSameTokens(game, { color: 'sapphire' });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(playerAt(result.gameState, 0).tokens.sapphire).toBe(2);
    expect(result.gameState.bank.sapphire).toBe(2);
  });

  it('rejects when fewer than four remain', () => {
    const game = newGame(2);
    game.bank.sapphire = 3;
    const result = takeTwoSameTokens(game, { color: 'sapphire' });
    expect(result).toEqual({ success: false, error: ERRORS.NOT_ENOUGH_IN_BANK_FOR_TWO });
  });

  it('rejects gold', () => {
    const game = newGame(2);
    const result = takeTwoSameTokens(game, { color: 'gold' as never });
    expect(result.error).toBe(ERRORS.INVALID_COLOR);
  });

  it('does not mutate the state it was given', () => {
    const game = newGame(2);
    const before = JSON.stringify(game);
    takeTwoSameTokens(game, { color: 'sapphire' });
    expect(JSON.stringify(game)).toBe(before);
  });
});

describe('advanceTurn', () => {
  it('wraps around the table and counts turns', () => {
    let game = newGame(3);
    expect(game.currentPlayerIndex).toBe(0);

    game = advanceTurn(game);
    expect(game.currentPlayerIndex).toBe(1);
    expect(game.turnCount).toBe(1);

    game = advanceTurn(advanceTurn(game));
    expect(game.currentPlayerIndex).toBe(0);
    expect(game.turnCount).toBe(3);
  });
});

describe('validateAction', () => {
  const takeThree = {
    type: 'take_three_different',
    colors: ['emerald', 'ruby', 'onyx'],
  } as const;

  it('accepts the player whose turn it is', () => {
    const game = newGame(2);
    expect(validateAction(game, 'p1', takeThree)).toEqual({ ok: true });
  });

  it('rejects a player acting out of turn', () => {
    const game = newGame(2);
    expect(validateAction(game, 'p2', takeThree)).toEqual({
      ok: false,
      error: ERRORS.NOT_YOUR_TURN,
    });
  });

  it('rejects an unknown player', () => {
    const game = newGame(2);
    expect(validateAction(game, 'nobody', takeThree)).toEqual({
      ok: false,
      error: ERRORS.UNKNOWN_PLAYER,
    });
  });

  it('rejects any action once the game is finished', () => {
    const game = newGame(2);
    game.status = 'finished';
    expect(validateAction(game, 'p1', takeThree)).toEqual({
      ok: false,
      error: ERRORS.GAME_NOT_PLAYING,
    });
  });

  it('rejects a discard when none is pending', () => {
    const game = newGame(2);
    const result = validateAction(game, 'p1', {
      type: 'discard_tokens',
      tokensToDiscard: { ruby: 1 },
    });
    expect(result).toEqual({ ok: false, error: ERRORS.NO_DISCARD_PENDING });
  });
});

describe('applyAction turn flow', () => {
  it('hands the turn to the next player after a successful action', () => {
    const game = newGame(2);
    const result = applyAction(game, 'p1', {
      type: 'take_three_different',
      colors: ['emerald', 'ruby', 'onyx'],
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.gameState.currentPlayerIndex).toBe(1);
    expect(result.gameState.turnCount).toBe(1);
  });

  it('leaves the turn alone when the action is rejected', () => {
    const game = newGame(2);
    const result = applyAction(game, 'p2', {
      type: 'take_three_different',
      colors: ['emerald', 'ruby', 'onyx'],
    });

    expect(result).toEqual({ success: false, error: ERRORS.NOT_YOUR_TURN });
    expect(game.currentPlayerIndex).toBe(0);
  });

  it('rejects an unknown action type', () => {
    const game = newGame(2);
    const result = applyAction(game, 'p1', { type: 'teleport' } as never);
    expect(result.error).toBe(ERRORS.UNKNOWN_ACTION);
  });
});
