/** Public surface of the engine. Nothing here may import socket.io or express. */
export { createGame, createBank, nobleCountFor, shuffle } from './gameState.js';
export type { PlayerSeed, Rng, CreateGameOptions } from './gameState.js';

export {
  takeThreeDifferentTokens,
  takeTwoSameTokens,
  reserveCard,
  buyCard,
  discardExcessTokens,
  paymentFor,
  heldTokens,
} from './actions.js';

export {
  applyAction,
  validateAction,
  advanceTurn,
  checkNobleVisit,
  checkWinCondition,
  determineWinner,
} from './rules.js';

export { ALL_CARDS, CARDS_BY_TIER, getCardById } from './cards.js';
export { ALL_NOBLES } from './nobles.js';
export { ERRORS } from './errors.js';
export type { ErrorCode } from './errors.js';
export * from './constants.js';
