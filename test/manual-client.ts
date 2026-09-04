/**
 * Scripted two-client run of the brief's Definition of Done for Fase 2.
 * Boots the server in-process, drives real socket.io clients, asserts on every event,
 * and exits non-zero on the first failure — a smoke test, not a demo.
 *
 *   npm run smoke
 */
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { io as createClient } from 'socket.io-client';
import type { Socket as ClientSocket } from 'socket.io-client';
import { createApp } from '../src/app.js';
import type { ClientToServerEvents, ServerToClientEvents } from '../src/types.js';

type TestClient = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

const checks: string[] = [];

function ok(label: string): void {
  checks.push(label);
  console.log(`  ok  ${label}`);
}

/**
 * socket.io's listener generics do not narrow when the event name is itself a type
 * parameter, so the helpers below talk to this loose view. The casts stay in one place;
 * every call site keeps a fully typed payload.
 */
interface RawListeners {
  once(event: string, listener: (payload: unknown) => void): void;
  off(event: string, listener: (payload: unknown) => void): void;
}
const raw = (socket: TestClient): RawListeners => socket as unknown as RawListeners;

/** Resolve on the next occurrence of `event`, or reject after `timeoutMs`. */
function once<E extends keyof ServerToClientEvents>(
  socket: TestClient,
  event: E,
  timeoutMs = 2000,
): Promise<Parameters<ServerToClientEvents[E]>[0]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      raw(socket).off(String(event), handler);
      reject(new Error(`timed out waiting for "${String(event)}"`));
    }, timeoutMs);
    const handler = (payload: unknown) => {
      clearTimeout(timer);
      resolve(payload as Parameters<ServerToClientEvents[E]>[0]);
    };
    raw(socket).once(String(event), handler);
  });
}

/** Assert that `event` does NOT arrive within the window. */
async function never<E extends keyof ServerToClientEvents>(
  socket: TestClient,
  event: E,
  windowMs = 300,
): Promise<void> {
  let fired = false;
  const handler = () => {
    fired = true;
  };
  raw(socket).once(String(event), handler);
  await new Promise((resolve) => setTimeout(resolve, windowMs));
  raw(socket).off(String(event), handler);
  assert.equal(fired, false, `expected no "${String(event)}" but one arrived`);
}

function connect(url: string): Promise<TestClient> {
  const socket: TestClient = createClient(url, { transports: ['websocket'] });
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

async function main(): Promise<void> {
  const { httpServer } = createApp({ corsOrigin: '*' });
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const { port } = httpServer.address() as AddressInfo;
  const url = `http://localhost:${port}`;
  console.log(`server up on ${url}\n`);

  const host = await connect(url);
  const guest = await connect(url);

  // --- create_room ---------------------------------------------------------
  const created = once(host, 'room_created');
  host.emit('create_room', { name: 'Alice' });
  const { roomId, playerId: hostId } = await created;
  assert.match(roomId, /^[A-Z0-9]{6}$/, 'roomId is 6 uppercase alphanumeric chars');
  ok(`create_room -> room ${roomId}`);

  // --- join_room -----------------------------------------------------------
  const joined = once(guest, 'room_joined');
  const hostSeesList = once(host, 'player_list_update');
  guest.emit('join_room', { roomId, name: 'Bob' });
  const joinedPayload = await joined;
  const listPayload = await hostSeesList;
  assert.equal(joinedPayload.roomId, roomId);
  assert.equal(listPayload.players.length, 2, 'both seats visible');
  assert.equal(listPayload.players.filter((p) => p.isHost).length, 1, 'exactly one host');
  ok('join_room -> room_joined to joiner + player_list_update to all');

  // --- join guards ---------------------------------------------------------
  const dupeName = once(guest, 'action_error');
  guest.emit('join_room', { roomId, name: 'Alice' });
  assert.equal((await dupeName).error, 'NAME_TAKEN');
  ok('join_room with a taken name -> NAME_TAKEN');

  const badRoom = once(guest, 'action_error');
  guest.emit('join_room', { roomId: 'ZZZZZZ', name: 'Carol' });
  assert.equal((await badRoom).error, 'ROOM_NOT_FOUND');
  ok('join_room with an unknown room -> ROOM_NOT_FOUND');

  // --- start_game guards ---------------------------------------------------
  const notHost = once(guest, 'action_error');
  guest.emit('start_game', { roomId });
  assert.equal((await notHost).error, 'NOT_HOST');
  ok('start_game from a non-host -> NOT_HOST');

  const soloRoomHost = await connect(url);
  const soloCreated = once(soloRoomHost, 'room_created');
  soloRoomHost.emit('create_room', { name: 'Solo' });
  const solo = await soloCreated;
  const tooFew = once(soloRoomHost, 'action_error');
  soloRoomHost.emit('start_game', { roomId: solo.roomId });
  assert.equal((await tooFew).error, 'NOT_ENOUGH_PLAYERS');
  soloRoomHost.disconnect();
  ok('start_game with one player -> NOT_ENOUGH_PLAYERS');

  // --- room capacity -------------------------------------------------------
  const extras: TestClient[] = [];
  for (const name of ['Carol', 'Dave']) {
    const extra = await connect(url);
    const extraJoined = once(extra, 'room_joined');
    extra.emit('join_room', { roomId, name });
    await extraJoined;
    extras.push(extra);
  }
  const fifth = await connect(url);
  const full = once(fifth, 'action_error');
  fifth.emit('join_room', { roomId, name: 'Eve' });
  assert.equal((await full).error, 'ROOM_FULL');
  fifth.disconnect();
  // Back down to two seats for the rest of the run.
  for (const extra of extras) {
    const dropped = once(host, 'player_list_update');
    extra.disconnect();
    await dropped;
  }
  ok('join_room beyond four players -> ROOM_FULL');

  // --- start_game ----------------------------------------------------------
  // state_update follows game_started in the same tick, so both listeners go on first.
  const hostStarted = once(host, 'game_started');
  const guestStarted = once(guest, 'game_started');
  const hostStateP = once(host, 'state_update');
  host.emit('start_game', { roomId });
  const startPayload = await hostStarted;
  await guestStarted;
  assert.equal(startPayload.gameState.players.length, 2);
  assert.equal(startPayload.gameState.bank.emerald, 4, '2-player bank is 4 per gem colour');
  assert.equal(startPayload.gameState.bank.gold, 5, 'gold is always 5');
  assert.equal(startPayload.gameState.status, 'playing');
  ok('start_game -> game_started to both, bank sized for 2 players');

  const hostState = await hostStateP;
  assert.equal(hostState.roomId, roomId);
  ok('start_game -> state_update to all');

  // --- player_action, legal ------------------------------------------------
  const hostAfterMove = once(host, 'state_update');
  const guestAfterMove = once(guest, 'state_update');
  host.emit('player_action', {
    roomId,
    action: { type: 'take_three_different', colors: ['emerald', 'ruby', 'onyx'] },
  });
  const moved = await hostAfterMove;
  await guestAfterMove;
  const alice = moved.gameState.players[0];
  assert.equal(alice?.tokens.emerald, 1, 'Alice took an emerald');
  assert.equal(moved.gameState.bank.emerald, 3, 'bank went down by one');
  assert.equal(moved.gameState.currentPlayerIndex, 1, 'turn passed to Bob');
  ok('player_action (legal) -> state_update broadcast to everyone, turn advanced');

  // --- player_action, illegal ----------------------------------------------
  const actionErr = once(host, 'action_error');
  const guestSeesNothing = never(guest, 'action_error');
  host.emit('player_action', {
    roomId,
    action: { type: 'take_two_same', color: 'ruby' },
  });
  const errPayload = await actionErr;
  await guestSeesNothing;
  assert.equal(errPayload.error, 'NOT_YOUR_TURN');
  ok('player_action (out of turn) -> action_error to sender only');

  // --- a card action, end to end -------------------------------------------
  const reserveTargetId = moved.gameState.tableCards.tier1[0]?.id;
  assert.ok(reserveTargetId, 'a tier 1 card is face up');
  const afterReserve = once(guest, 'state_update');
  guest.emit('player_action', { roomId, action: { type: 'reserve_card', cardId: reserveTargetId } });
  const reserved = await afterReserve;
  const bob = reserved.gameState.players[1];
  assert.equal(bob?.reservedCards.length, 1, 'Bob holds one reserved card');
  assert.equal(bob?.tokens.gold, 1, 'reserving paid out a gold token');
  assert.equal(reserved.gameState.tableCards.tier1.length, 4, 'the slot refilled');
  assert.equal(reserved.gameState.currentPlayerIndex, 0, 'turn came back to Alice');
  ok('player_action (reserve) -> card reserved, gold paid, slot refilled');

  // --- disconnect ----------------------------------------------------------
  const listAfterDrop = once(host, 'player_list_update');
  guest.disconnect();
  const afterDrop = await listAfterDrop;
  assert.equal(afterDrop.players.length, 2, 'seat is kept, not removed');
  const bobSeat = afterDrop.players.find((p) => p.name === 'Bob');
  assert.equal(bobSeat?.connected, false, 'Bob marked disconnected');
  ok('disconnect -> seat kept, connected:false, player_list_update broadcast');

  // --- rejoin_room ---------------------------------------------------------
  const rejoiner = await connect(url);
  const rejoined = once(rejoiner, 'room_joined');
  const restoredState = once(rejoiner, 'state_update');
  rejoiner.emit('rejoin_room', { roomId, name: 'Bob' });
  const rejoinPayload = await rejoined;
  const restored = await restoredState;
  assert.notEqual(rejoinPayload.playerId, hostId);
  assert.equal(restored.gameState.players.length, 2, 'last state replayed to the rejoiner');
  const bobBack = rejoinPayload.players.find((p) => p.name === 'Bob');
  assert.equal(bobBack?.connected, true, 'Bob reconnected');
  ok('rejoin_room -> seat restored by name + state_update replayed');

  host.disconnect();
  rejoiner.disconnect();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));

  console.log(`\nall ${checks.length} checks passed`);
}

main().catch((error: unknown) => {
  console.error('\nSMOKE TEST FAILED');
  console.error(error);
  process.exit(1);
});
