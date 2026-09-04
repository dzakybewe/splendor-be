import type { Server, Socket } from 'socket.io';
import type {
  ClientToServerEvents,
  CreateRoomPayload,
  GameState,
  JoinRoomPayload,
  PlayerActionPayload,
  RejoinRoomPayload,
  Room,
  ServerToClientEvents,
  SocketData,
  StartGamePayload,
} from '../types.js';
import { applyAction, createGame, MIN_PLAYERS } from '../engine/index.js';
import * as roomManager from '../rooms/roomManager.js';
import { SOCKET_ERRORS } from './errors.js';

export type SplendorServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;
export type SplendorSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

/**
 * The single chokepoint for state going over the wire. Today it is the identity
 * function — the full GameState is broadcast to everyone, deck order included, by
 * explicit decision. If per-player redaction is ever wanted (hiding deck contents and
 * opponents' deck-reserved cards), this is the only function that has to change.
 */
function serialize(gameState: GameState): GameState {
  return gameState;
}

function fail(socket: SplendorSocket, error: string): void {
  socket.emit('action_error', { error });
}

function broadcastPlayerList(io: SplendorServer, room: Room): void {
  io.to(room.roomId).emit('player_list_update', {
    roomId: room.roomId,
    players: roomManager.playerList(room),
  });
}

function broadcastState(io: SplendorServer, room: Room): void {
  if (!room.gameState) return;
  io.to(room.roomId).emit('state_update', {
    roomId: room.roomId,
    gameState: serialize(room.gameState),
  });
}

function cleanName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 20 ? trimmed : null;
}

function resolveRoom(socket: SplendorSocket, roomId: unknown): Room | null {
  if (typeof roomId !== 'string') {
    fail(socket, SOCKET_ERRORS.INVALID_PAYLOAD);
    return null;
  }
  const room = roomManager.getRoom(roomId.toUpperCase());
  if (!room) {
    fail(socket, SOCKET_ERRORS.ROOM_NOT_FOUND);
    return null;
  }
  return room;
}

export function registerHandlers(io: SplendorServer, socket: SplendorSocket): void {
  socket.data.roomId = null;
  socket.data.playerId = null;

  socket.on('create_room', (payload: CreateRoomPayload) => {
    const name = cleanName(payload?.name);
    if (!name) return fail(socket, SOCKET_ERRORS.NAME_REQUIRED);

    const { room, player } = roomManager.createRoom(name, socket.id);
    socket.join(room.roomId);
    socket.data.roomId = room.roomId;
    socket.data.playerId = player.playerId;

    // No player_list_update here: the creator is alone in the room and room_created
    // already carries the list.
    socket.emit('room_created', {
      roomId: room.roomId,
      playerId: player.playerId,
      players: roomManager.playerList(room),
    });
  });

  socket.on('join_room', (payload: JoinRoomPayload) => {
    const room = resolveRoom(socket, payload?.roomId);
    if (!room) return;

    const name = cleanName(payload?.name);
    if (!name) return fail(socket, SOCKET_ERRORS.NAME_REQUIRED);
    if (roomManager.hasStarted(room)) return fail(socket, SOCKET_ERRORS.ROOM_ALREADY_STARTED);
    if (roomManager.isFull(room)) return fail(socket, SOCKET_ERRORS.ROOM_FULL);
    // Names are the rejoin key, so they have to be unique within a room.
    if (roomManager.findPlayerByName(room, name)) return fail(socket, SOCKET_ERRORS.NAME_TAKEN);

    const player = roomManager.addPlayer(room, name, socket.id);
    socket.join(room.roomId);
    socket.data.roomId = room.roomId;
    socket.data.playerId = player.playerId;

    socket.emit('room_joined', {
      roomId: room.roomId,
      playerId: player.playerId,
      players: roomManager.playerList(room),
    });
    broadcastPlayerList(io, room);
  });

  socket.on('start_game', (payload: StartGamePayload) => {
    const room = resolveRoom(socket, payload?.roomId);
    if (!room) return;

    const requester = roomManager.findPlayerBySocket(room, socket.id);
    if (!requester) return fail(socket, SOCKET_ERRORS.NOT_IN_ROOM);
    if (requester.playerId !== room.hostPlayerId) return fail(socket, SOCKET_ERRORS.NOT_HOST);
    if (roomManager.hasStarted(room)) return fail(socket, SOCKET_ERRORS.ROOM_ALREADY_STARTED);
    if (room.players.length < MIN_PLAYERS) return fail(socket, SOCKET_ERRORS.NOT_ENOUGH_PLAYERS);

    const gameState = createGame(
      room.players.map((player) => ({ playerId: player.playerId, name: player.name })),
    );
    roomManager.setGameState(room, gameState);

    io.to(room.roomId).emit('game_started', {
      roomId: room.roomId,
      gameState: serialize(gameState),
    });
    broadcastState(io, room);
  });

  socket.on('player_action', (payload: PlayerActionPayload) => {
    const room = resolveRoom(socket, payload?.roomId);
    if (!room) return;
    if (!room.gameState) return fail(socket, SOCKET_ERRORS.GAME_NOT_STARTED);

    const player = roomManager.findPlayerBySocket(room, socket.id);
    if (!player) return fail(socket, SOCKET_ERRORS.NOT_IN_ROOM);
    if (!payload?.action || typeof payload.action.type !== 'string') {
      return fail(socket, SOCKET_ERRORS.INVALID_PAYLOAD);
    }

    const result = applyAction(room.gameState, player.playerId, payload.action);
    if (!result.success) return fail(socket, result.error);

    roomManager.setGameState(room, result.gameState);
    broadcastState(io, room);
  });

  socket.on('rejoin_room', (payload: RejoinRoomPayload) => {
    const room = resolveRoom(socket, payload?.roomId);
    if (!room) return;

    const name = cleanName(payload?.name);
    if (!name) return fail(socket, SOCKET_ERRORS.NAME_REQUIRED);

    const seat = roomManager.findPlayerByName(room, name);
    if (!seat) return fail(socket, SOCKET_ERRORS.NO_SUCH_PLAYER);
    // A live socket already holds this seat; a second claim would evict a real player.
    if (seat.connected && seat.socketId !== socket.id) {
      return fail(socket, SOCKET_ERRORS.ALREADY_CONNECTED);
    }

    const player = roomManager.reconnect(room, name, socket.id);
    if (!player) return fail(socket, SOCKET_ERRORS.NO_SUCH_PLAYER);

    socket.join(room.roomId);
    socket.data.roomId = room.roomId;
    socket.data.playerId = player.playerId;

    socket.emit('room_joined', {
      roomId: room.roomId,
      playerId: player.playerId,
      players: roomManager.playerList(room),
    });
    if (room.gameState) {
      socket.emit('state_update', { roomId: room.roomId, gameState: serialize(room.gameState) });
    }
    broadcastPlayerList(io, room);
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;

    const result = roomManager.markDisconnected(roomId, socket.id);
    socket.data.roomId = null;
    socket.data.playerId = null;
    if (!result) return;

    // The room may have been dropped outright (unstarted and now empty).
    if (roomManager.getRoom(roomId)) broadcastPlayerList(io, result.room);
  });
}
