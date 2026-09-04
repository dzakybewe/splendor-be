/**
 * Room/lobby level rejections. Engine rejections live in src/engine/errors.ts.
 * All of these reach the client on the `action_error` channel, the only error event
 * in the contract.
 */
export const SOCKET_ERRORS = {
  INVALID_PAYLOAD: 'INVALID_PAYLOAD',
  NAME_REQUIRED: 'NAME_REQUIRED',
  ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
  ROOM_FULL: 'ROOM_FULL',
  ROOM_ALREADY_STARTED: 'ROOM_ALREADY_STARTED',
  GAME_NOT_STARTED: 'GAME_NOT_STARTED',
  NAME_TAKEN: 'NAME_TAKEN',
  NOT_HOST: 'NOT_HOST',
  NOT_ENOUGH_PLAYERS: 'NOT_ENOUGH_PLAYERS',
  NOT_IN_ROOM: 'NOT_IN_ROOM',
  NO_SUCH_PLAYER: 'NO_SUCH_PLAYER',
  ALREADY_CONNECTED: 'ALREADY_CONNECTED',
} as const;

export type SocketErrorCode = (typeof SOCKET_ERRORS)[keyof typeof SOCKET_ERRORS];
