import { buyCard, paymentFor, reserveCard } from '../src/engine/actions.js';
import { ERRORS } from '../src/engine/errors.js';
import type { Card, GameState } from '../src/types.js';
import { bonusCards, card, cost, newGame, playerAt, tokens } from './helpers.js';

/** Put a known card in the first tier-1 slot so the tests do not depend on the deal. */
function withTableCard(game: GameState, replacement: Card): Card {
  game.tableCards.tier1[0] = replacement;
  return replacement;
}

describe('reserveCard', () => {
  it('takes a face-up card, refills the slot, and hands over a gold token', () => {
    const game = newGame(2);
    const target = withTableCard(game, card({ id: 'target', bonus: 'ruby' }));
    const replacementId = game.decks.tier1[0]?.id;

    const result = reserveCard(game, { cardId: target.id });
    expect(result.success).toBe(true);
    if (!result.success) return;

    const player = playerAt(result.gameState, 0);
    expect(player.reservedCards.map((c) => c.id)).toEqual(['target']);
    expect(player.tokens.gold).toBe(1);
    expect(result.gameState.bank.gold).toBe(4);
    expect(result.gameState.tableCards.tier1).toHaveLength(4);
    expect(result.gameState.tableCards.tier1[0]?.id).toBe(replacementId);
    expect(result.gameState.decks.tier1).toHaveLength(35);
  });

  it('reserves the unseen top card of a tier without touching the table', () => {
    const game = newGame(2);
    const topOfDeck = game.decks.tier2[0]?.id;
    const tableBefore = game.tableCards.tier2.map((c) => c.id);

    const result = reserveCard(game, { tier: 2, fromDeck: true });
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(playerAt(result.gameState, 0).reservedCards[0]?.id).toBe(topOfDeck);
    expect(result.gameState.tableCards.tier2.map((c) => c.id)).toEqual(tableBefore);
    expect(result.gameState.decks.tier2).toHaveLength(25);
  });

  it('still reserves when the gold pile is empty, just without gold', () => {
    const game = newGame(2);
    game.bank.gold = 0;

    const result = reserveCard(game, { cardId: game.tableCards.tier1[0]?.id ?? '' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(playerAt(result.gameState, 0).reservedCards).toHaveLength(1);
    expect(playerAt(result.gameState, 0).tokens.gold).toBe(0);
  });

  it('rejects a fourth reservation', () => {
    const game = newGame(2);
    playerAt(game, 0).reservedCards = [
      card({ id: 'r1', bonus: 'ruby' }),
      card({ id: 'r2', bonus: 'ruby' }),
      card({ id: 'r3', bonus: 'ruby' }),
    ];

    const result = reserveCard(game, { cardId: game.tableCards.tier1[0]?.id ?? '' });
    expect(result).toEqual({ success: false, error: ERRORS.RESERVE_LIMIT_REACHED });
  });

  it('rejects reserving from an empty deck', () => {
    const game = newGame(2);
    game.decks.tier3 = [];
    const result = reserveCard(game, { tier: 3, fromDeck: true });
    expect(result).toEqual({ success: false, error: ERRORS.DECK_EMPTY });
  });

  it('rejects an unknown tier and an unknown card', () => {
    const game = newGame(2);
    expect(reserveCard(game, { tier: 9 as never, fromDeck: true }).error).toBe(ERRORS.INVALID_TIER);
    expect(reserveCard(game, { cardId: 'nope' }).error).toBe(ERRORS.CARD_NOT_ON_TABLE);
  });

  it('shortens the row instead of refilling once the deck runs dry', () => {
    const game = newGame(2);
    game.decks.tier1 = [];
    const targetId = game.tableCards.tier1[0]?.id ?? '';

    const result = reserveCard(game, { cardId: targetId });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.gameState.tableCards.tier1).toHaveLength(3);
  });

  it('does not mutate the state it was given', () => {
    const game = newGame(2);
    const before = JSON.stringify(game);
    reserveCard(game, { cardId: game.tableCards.tier1[0]?.id ?? '' });
    expect(JSON.stringify(game)).toBe(before);
  });
});

describe('paymentFor', () => {
  it('discounts the cost by the bonuses the player already owns', () => {
    const game = newGame(2);
    const player = playerAt(game, 0);
    player.cardsOwned = bonusCards('ruby', 2);
    player.tokens = tokens({ ruby: 5, onyx: 5 });

    const target = card({ id: 'x', bonus: 'diamond', cost: cost({ ruby: 3, onyx: 1 }) });
    expect(paymentFor(player, target)).toEqual({ tokens: { ruby: 1, onyx: 1 }, gold: 0 });
  });

  it('covers the shortfall with gold', () => {
    const game = newGame(2);
    const player = playerAt(game, 0);
    player.tokens = tokens({ ruby: 1, gold: 2 });

    const target = card({ id: 'x', bonus: 'diamond', cost: cost({ ruby: 3 }) });
    expect(paymentFor(player, target)).toEqual({ tokens: { ruby: 1, gold: 2 }, gold: 2 });
  });

  it('returns null when even gold cannot cover it', () => {
    const game = newGame(2);
    const player = playerAt(game, 0);
    player.tokens = tokens({ ruby: 1, gold: 1 });

    const target = card({ id: 'x', bonus: 'diamond', cost: cost({ ruby: 4 }) });
    expect(paymentFor(player, target)).toBeNull();
  });

  it('costs nothing when bonuses already cover the card', () => {
    const game = newGame(2);
    const player = playerAt(game, 0);
    player.cardsOwned = bonusCards('ruby', 4);

    const target = card({ id: 'x', bonus: 'diamond', cost: cost({ ruby: 3 }) });
    expect(paymentFor(player, target)).toEqual({ tokens: {}, gold: 0 });
  });
});

describe('buyCard', () => {
  it('buys a face-up card, pays the bank, scores the points, and refills the slot', () => {
    const game = newGame(2);
    const target = withTableCard(
      game,
      card({ id: 'target', bonus: 'onyx', points: 3, cost: cost({ ruby: 2, sapphire: 1 }) }),
    );
    playerAt(game, 0).tokens = tokens({ ruby: 2, sapphire: 1 });
    const replacementId = game.decks.tier1[0]?.id;

    const result = buyCard(game, { cardId: target.id });
    expect(result.success).toBe(true);
    if (!result.success) return;

    const player = playerAt(result.gameState, 0);
    expect(player.cardsOwned.map((c) => c.id)).toEqual(['target']);
    expect(player.points).toBe(3);
    expect(player.tokens.ruby).toBe(0);
    expect(player.tokens.sapphire).toBe(0);
    // Spent tokens go back into the bank, which started at 4 of each.
    expect(result.gameState.bank.ruby).toBe(6);
    expect(result.gameState.bank.sapphire).toBe(5);
    expect(result.gameState.tableCards.tier1[0]?.id).toBe(replacementId);
  });

  it('applies colour bonuses from cards already owned', () => {
    const game = newGame(2);
    const target = withTableCard(
      game,
      card({ id: 'target', bonus: 'onyx', points: 1, cost: cost({ ruby: 3 }) }),
    );
    const player = playerAt(game, 0);
    player.cardsOwned = bonusCards('ruby', 2);
    player.tokens = tokens({ ruby: 1 });

    const result = buyCard(game, { cardId: target.id });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(playerAt(result.gameState, 0).tokens.ruby).toBe(0);
    expect(playerAt(result.gameState, 0).points).toBe(1);
  });

  it('spends gold as a wildcard', () => {
    const game = newGame(2);
    const target = withTableCard(
      game,
      card({ id: 'target', bonus: 'onyx', cost: cost({ ruby: 2, emerald: 2 }) }),
    );
    playerAt(game, 0).tokens = tokens({ ruby: 2, gold: 2 });

    const result = buyCard(game, { cardId: target.id });
    expect(result.success).toBe(true);
    if (!result.success) return;

    const player = playerAt(result.gameState, 0);
    expect(player.tokens.gold).toBe(0);
    expect(player.tokens.ruby).toBe(0);
    expect(result.gameState.bank.gold).toBe(7); // 5 at setup + 2 returned
  });

  it('rejects a purchase the player cannot afford', () => {
    const game = newGame(2);
    const target = withTableCard(
      game,
      card({ id: 'target', bonus: 'onyx', cost: cost({ ruby: 3 }) }),
    );
    playerAt(game, 0).tokens = tokens({ ruby: 1, gold: 1 });

    const result = buyCard(game, { cardId: target.id });
    expect(result).toEqual({ success: false, error: ERRORS.INSUFFICIENT_RESOURCES });
  });

  it('buys from the player own reserve and clears the reservation', () => {
    const game = newGame(2);
    const reserved = card({ id: 'res', bonus: 'emerald', points: 2, cost: cost({ onyx: 2 }) });
    const player = playerAt(game, 0);
    player.reservedCards = [reserved];
    player.tokens = tokens({ onyx: 2 });

    const result = buyCard(game, { cardId: 'res', fromReserved: true });
    expect(result.success).toBe(true);
    if (!result.success) return;

    const after = playerAt(result.gameState, 0);
    expect(after.reservedCards).toHaveLength(0);
    expect(after.cardsOwned.map((c) => c.id)).toEqual(['res']);
    expect(after.points).toBe(2);
  });

  it('rejects fromReserved for a card that is not reserved', () => {
    const game = newGame(2);
    const result = buyCard(game, { cardId: 'nope', fromReserved: true });
    expect(result).toEqual({ success: false, error: ERRORS.CARD_NOT_RESERVED });
  });

  it('rejects a table buy for a card that is not on the table', () => {
    const game = newGame(2);
    expect(buyCard(game, { cardId: 'nope' }).error).toBe(ERRORS.CARD_NOT_ON_TABLE);
  });

  it('does not mutate the state it was given', () => {
    const game = newGame(2);
    const target = withTableCard(
      game,
      card({ id: 'target', bonus: 'onyx', cost: cost({ ruby: 1 }) }),
    );
    playerAt(game, 0).tokens = tokens({ ruby: 1 });
    const before = JSON.stringify(game);

    buyCard(game, { cardId: target.id });
    expect(JSON.stringify(game)).toBe(before);
  });
});
