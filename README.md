# Splendor — Backend

Authoritative game server for 2–4 human players. Express + Socket.IO, all state in memory
per room, no database and no accounts. Clients send intents; the server validates and
computes every state change.

## Running it

```bash
npm install
npm run dev        # tsx, hot reload, :3000
npm run build      # tsc -> dist/
npm start          # node dist/server.js
```

| Env var | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | HTTP/socket port |
| `CORS_ORIGIN` | `*` | Comma-separated allow list of frontend origins |

`GET /health` returns `{ok: true, rooms: <count>}`.

## Checks

```bash
npm run typecheck  # tsc --noEmit
npm test           # Jest engine + room suites
npm run smoke      # scripted two-client run of the whole socket contract
```

`npm run smoke` boots the server in-process, drives real socket.io clients through
create → join → start → play → disconnect → rejoin, and exits non-zero on any failed
assertion.

## Socket.IO contract

Types for every payload below live in [`src/types.ts`](src/types.ts) — import that file
from the frontend rather than redeclaring the shapes.

### Client → server

| Event | Payload |
|---|---|
| `create_room` | `{name}` |
| `join_room` | `{roomId, name}` |
| `start_game` | `{roomId}` |
| `player_action` | `{roomId, action}` |
| `rejoin_room` | `{roomId, name}` |

### Server → client

| Event | Payload | Sent to |
|---|---|---|
| `room_created` | `{roomId, playerId, players}` | creator |
| `room_joined` | `{roomId, playerId, players}` | joiner / rejoiner |
| `player_list_update` | `{roomId, players}` | everyone in the room |
| `game_started` | `{roomId, gameState}` | everyone in the room |
| `state_update` | `{roomId, gameState}` | everyone in the room |
| `action_error` | `{error}` | the sender only |

`action_error` carries a stable code, never prose — see
[`src/engine/errors.ts`](src/engine/errors.ts) and
[`src/socket/errors.ts`](src/socket/errors.ts).

### Actions

`player_action.action` is a tagged union:

```ts
{ type: 'take_three_different', colors: [Color, Color, Color] }
{ type: 'take_two_same', color: Color }
{ type: 'reserve_card', cardId: string }
{ type: 'reserve_card', tier: 1|2|3, fromDeck: true }
{ type: 'buy_card', cardId: string, fromReserved?: boolean }
{ type: 'discard_tokens', tokensToDiscard: { [color]: number } }
```

## Rules the brief left open

| Case | Behaviour |
|---|---|
| Winning | Reaching 15 points arms a final round so every player gets equal turns; then most points wins, ties broken by fewest development cards |
| Nobles | `players + 1` nobles are dealt. If several qualify at once the server awards the first in table order — no client round-trip |
| Over 10 tokens | The turn **blocks**: `pendingDiscard` is set, no other action is accepted from anyone, and the turn only advances once the player discards down to exactly 10 |
| Reserving | Legal with an empty gold pile (you just get no gold); rejected from an empty deck or with 3 cards already reserved |
| Empty deck | A bought or reserved face-up card is not replaced; the row gets shorter |
| Leaving a lobby | Before the game starts, disconnecting frees the seat and the name, and the host badge passes on |
| Leaving a game | After it starts, the seat is held and the turn is never skipped. `rejoin_room` restores it by name. A room with every player disconnected is dropped after 60s |

## Notes for the frontend

**The full `GameState` is broadcast to everyone, deck order included.** This was an
explicit decision, but it means a client with devtools can read upcoming cards and
opponents' deck-reserved cards. If that ever needs fixing, `serialize()` in
[`src/socket/handlers.ts`](src/socket/handlers.ts) is the only function to change.

## Layout

```
src/
  engine/      pure game logic — must never import socket.io or express
    cards.ts       the 90 development cards
    nobles.ts      the 10 nobles
    gameState.ts   setup, shuffling, bank sizing
    actions.ts     take / reserve / buy / discard
    rules.ts       validation, turn order, nobles, win condition, applyAction pipeline
  rooms/       in-memory room registry and connection lifecycle
  socket/      Socket.IO event handlers — the only layer that knows about sockets
  types.ts     game shapes + the wire contract
test/
  manual-client.ts   the two-client smoke run
```

Engine functions never mutate the state passed to them; they return a new `GameState`.
