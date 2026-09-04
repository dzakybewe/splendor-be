import { randomInt, randomUUID } from 'node:crypto';
import type { GameState, PlayerListEntry, Room, RoomPlayer } from '../types.js';
import { MAX_PLAYERS } from '../engine/constants.js';

/**
 * Room codes get read aloud and typed by hand, so they stay uppercase alphanumeric —
 * no `-` or `_`. node:crypto covers this and the player ids, which is why there is no
 * nanoid dependency: its v5 line is ESM-only and would need a Jest transform carve-out
 * for a custom alphabet we have to supply anyway.
 */
const ROOM_CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const ROOM_CODE_LENGTH = 6;

function roomCode(): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
    code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

/** How long a room survives with every seat disconnected before it is dropped. */
export const EMPTY_ROOM_GRACE_MS = 60_000;

const rooms = new Map<string, Room>();

export function roomCount(): number {
  return rooms.size;
}

export function getRoom(roomId: string): Room | undefined {
  return rooms.get(roomId);
}

function newRoomId(): string {
  let roomId = roomCode();
  while (rooms.has(roomId)) roomId = roomCode();
  return roomId;
}

export function createRoom(name: string, socketId: string): { room: Room; player: RoomPlayer } {
  const roomId = newRoomId();
  const player: RoomPlayer = {
    playerId: randomUUID(),
    name,
    socketId,
    connected: true,
    isHost: true,
  };
  const room: Room = {
    roomId,
    hostPlayerId: player.playerId,
    players: [player],
    gameState: null,
    emptySinceTimer: null,
  };
  rooms.set(roomId, room);
  return { room, player };
}

export function addPlayer(room: Room, name: string, socketId: string): RoomPlayer {
  const player: RoomPlayer = {
    playerId: randomUUID(),
    name,
    socketId,
    connected: true,
    isHost: false,
  };
  room.players.push(player);
  cancelCleanup(room);
  return player;
}

export function isFull(room: Room): boolean {
  return room.players.length >= MAX_PLAYERS;
}

export function hasStarted(room: Room): boolean {
  return room.gameState !== null;
}

export function findPlayerByName(room: Room, name: string): RoomPlayer | undefined {
  return room.players.find((player) => player.name === name);
}

export function findPlayerBySocket(room: Room, socketId: string): RoomPlayer | undefined {
  return room.players.find((player) => player.socketId === socketId);
}

export function findPlayerById(room: Room, playerId: string): RoomPlayer | undefined {
  return room.players.find((player) => player.playerId === playerId);
}

export function setGameState(room: Room, gameState: GameState): void {
  room.gameState = gameState;
}

/** Seat list safe to broadcast — socket ids stay server-side. */
export function playerList(room: Room): PlayerListEntry[] {
  return room.players.map(({ playerId, name, connected, isHost }) => ({
    playerId,
    name,
    connected,
    isHost,
  }));
}

// ---------------------------------------------------------------------------
// Connection lifecycle
// ---------------------------------------------------------------------------

function cancelCleanup(room: Room): void {
  if (room.emptySinceTimer) {
    clearTimeout(room.emptySinceTimer);
    room.emptySinceTimer = null;
  }
}

function scheduleCleanupIfEmpty(room: Room): void {
  const anyoneConnected = room.players.some((player) => player.connected);
  if (anyoneConnected) {
    cancelCleanup(room);
    return;
  }
  if (room.emptySinceTimer) return;
  room.emptySinceTimer = setTimeout(() => {
    // Re-check: someone may have rejoined and the timer raced the clear.
    const current = rooms.get(room.roomId);
    if (current && !current.players.some((player) => player.connected)) {
      rooms.delete(room.roomId);
    }
  }, EMPTY_ROOM_GRACE_MS);
  room.emptySinceTimer.unref?.();
}

/**
 * Handle a dropped socket.
 *
 * Once the game is running the seat is kept so the player can rejoin by name, and the
 * turn is never skipped. Before the game starts there is nothing to rejoin, so leaving
 * the lobby gives the seat back — otherwise a player who wandered off would keep both a
 * slot and their name locked up forever. The host badge moves on if the host is the one
 * who left.
 */
export function markDisconnected(
  roomId: string,
  socketId: string,
): { room: Room; player: RoomPlayer } | undefined {
  const room = rooms.get(roomId);
  if (!room) return undefined;
  const player = findPlayerBySocket(room, socketId);
  if (!player) return undefined;

  player.connected = false;
  player.socketId = null;

  if (!hasStarted(room)) {
    room.players = room.players.filter((seat) => seat.playerId !== player.playerId);
    if (room.players.length === 0) {
      cancelCleanup(room);
      rooms.delete(roomId);
      return { room, player };
    }
    if (room.hostPlayerId === player.playerId) {
      const successor = room.players[0];
      if (successor) {
        successor.isHost = true;
        room.hostPlayerId = successor.playerId;
      }
    }
    return { room, player };
  }

  scheduleCleanupIfEmpty(room);
  return { room, player };
}

/** Restore a seat after a reconnect, matching by name per the brief. */
export function reconnect(room: Room, name: string, socketId: string): RoomPlayer | undefined {
  const player = findPlayerByName(room, name);
  if (!player) return undefined;
  player.socketId = socketId;
  player.connected = true;
  cancelCleanup(room);
  return player;
}

/** Test hook — drops all rooms and their timers. */
export function resetRooms(): void {
  for (const room of rooms.values()) cancelCleanup(room);
  rooms.clear();
}
