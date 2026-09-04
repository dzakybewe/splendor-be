import {
  EMPTY_ROOM_GRACE_MS,
  addPlayer,
  createRoom,
  findPlayerByName,
  getRoom,
  hasStarted,
  isFull,
  markDisconnected,
  playerList,
  reconnect,
  resetRooms,
  roomCount,
  setGameState,
} from '../src/rooms/roomManager.js';
import { newGame } from './helpers.js';

beforeEach(() => {
  resetRooms();
});

afterEach(() => {
  resetRooms();
  jest.useRealTimers();
});

describe('room creation and seating', () => {
  it('gives out six-character uppercase room codes with no ambiguous punctuation', () => {
    const { room } = createRoom('Alice', 'socket-1');
    expect(room.roomId).toMatch(/^[A-Z0-9]{6}$/);
    expect(getRoom(room.roomId)).toBe(room);
    expect(roomCount()).toBe(1);
  });

  it('makes the creator the host and nobody else', () => {
    const { room, player } = createRoom('Alice', 'socket-1');
    addPlayer(room, 'Bob', 'socket-2');
    expect(room.hostPlayerId).toBe(player.playerId);
    expect(playerList(room).filter((seat) => seat.isHost)).toHaveLength(1);
  });

  it('counts as full at four players', () => {
    const { room } = createRoom('Alice', 'socket-1');
    expect(isFull(room)).toBe(false);
    addPlayer(room, 'Bob', 'socket-2');
    addPlayer(room, 'Carol', 'socket-3');
    addPlayer(room, 'Dave', 'socket-4');
    expect(isFull(room)).toBe(true);
  });

  it('keeps socket ids out of the broadcast player list', () => {
    const { room } = createRoom('Alice', 'socket-1');
    const entry = playerList(room)[0];
    expect(entry).toBeDefined();
    expect(Object.keys(entry ?? {}).sort()).toEqual(['connected', 'isHost', 'name', 'playerId']);
  });

  it('reports whether the game has started', () => {
    const { room } = createRoom('Alice', 'socket-1');
    expect(hasStarted(room)).toBe(false);
    addPlayer(room, 'Bob', 'socket-2');
    setGameState(room, newGame(2));
    expect(hasStarted(room)).toBe(true);
  });
});

describe('disconnect and rejoin', () => {
  it('keeps the seat and marks it disconnected', () => {
    const { room } = createRoom('Alice', 'socket-1');
    addPlayer(room, 'Bob', 'socket-2');
    setGameState(room, newGame(2));

    const result = markDisconnected(room.roomId, 'socket-2');
    expect(result?.player.name).toBe('Bob');
    expect(room.players).toHaveLength(2);
    expect(findPlayerByName(room, 'Bob')?.connected).toBe(false);
    expect(findPlayerByName(room, 'Bob')?.socketId).toBeNull();
  });

  it('restores the seat by name on rejoin', () => {
    const { room } = createRoom('Alice', 'socket-1');
    const bob = addPlayer(room, 'Bob', 'socket-2');
    setGameState(room, newGame(2));
    markDisconnected(room.roomId, 'socket-2');

    const restored = reconnect(room, 'Bob', 'socket-9');
    expect(restored?.playerId).toBe(bob.playerId);
    expect(restored?.socketId).toBe('socket-9');
    expect(restored?.connected).toBe(true);
  });

  it('does not invent a seat for an unknown name', () => {
    const { room } = createRoom('Alice', 'socket-1');
    expect(reconnect(room, 'Mallory', 'socket-9')).toBeUndefined();
  });

  it('drops an unstarted room as soon as it empties', () => {
    const { room } = createRoom('Alice', 'socket-1');
    markDisconnected(room.roomId, 'socket-1');
    expect(getRoom(room.roomId)).toBeUndefined();
  });

  it('frees the seat and the name when someone leaves before the game starts', () => {
    const { room } = createRoom('Alice', 'socket-1');
    addPlayer(room, 'Bob', 'socket-2');

    markDisconnected(room.roomId, 'socket-2');

    expect(room.players).toHaveLength(1);
    expect(findPlayerByName(room, 'Bob')).toBeUndefined();
    expect(isFull(room)).toBe(false);
  });

  it('passes the host badge on when the host leaves the lobby', () => {
    const { room } = createRoom('Alice', 'socket-1');
    const bob = addPlayer(room, 'Bob', 'socket-2');

    markDisconnected(room.roomId, 'socket-1');

    expect(room.hostPlayerId).toBe(bob.playerId);
    expect(playerList(room).filter((seat) => seat.isHost)).toHaveLength(1);
  });

  it('keeps a started room alive through the grace period, then drops it', () => {
    jest.useFakeTimers();
    const { room } = createRoom('Alice', 'socket-1');
    addPlayer(room, 'Bob', 'socket-2');
    setGameState(room, newGame(2));

    markDisconnected(room.roomId, 'socket-1');
    markDisconnected(room.roomId, 'socket-2');

    jest.advanceTimersByTime(EMPTY_ROOM_GRACE_MS - 1);
    expect(getRoom(room.roomId)).toBeDefined();

    jest.advanceTimersByTime(1);
    expect(getRoom(room.roomId)).toBeUndefined();
  });

  it('cancels the cleanup when somebody rejoins in time', () => {
    jest.useFakeTimers();
    const { room } = createRoom('Alice', 'socket-1');
    addPlayer(room, 'Bob', 'socket-2');
    setGameState(room, newGame(2));

    markDisconnected(room.roomId, 'socket-1');
    markDisconnected(room.roomId, 'socket-2');
    jest.advanceTimersByTime(EMPTY_ROOM_GRACE_MS / 2);

    reconnect(room, 'Bob', 'socket-9');
    jest.advanceTimersByTime(EMPTY_ROOM_GRACE_MS);

    expect(getRoom(room.roomId)).toBeDefined();
  });

  it('leaves the room alone while anyone is still connected', () => {
    jest.useFakeTimers();
    const { room } = createRoom('Alice', 'socket-1');
    addPlayer(room, 'Bob', 'socket-2');
    setGameState(room, newGame(2));

    markDisconnected(room.roomId, 'socket-2');
    jest.advanceTimersByTime(EMPTY_ROOM_GRACE_MS * 2);

    expect(getRoom(room.roomId)).toBeDefined();
  });

  it('ignores a disconnect for a room or socket it does not know', () => {
    const { room } = createRoom('Alice', 'socket-1');
    expect(markDisconnected('NOPE00', 'socket-1')).toBeUndefined();
    expect(markDisconnected(room.roomId, 'socket-unknown')).toBeUndefined();
  });
});
