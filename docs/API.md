# Backend API Reference (for the frontend)

Everything the frontend needs to render the game and send actions. All shapes below
are defined in [`../src/types.ts`](../src/types.ts) — import that file directly rather
than redeclaring these types.

For the high-level socket event table and run instructions, see [`../README.md`](../README.md).
This document goes one level deeper: full `GameState` shape, every action's payload
and preconditions, every error code, and the action log.

## Contents

- [GameState shape](#gamestate-shape)
- [Actions](#actions)
- [Error codes](#error-codes)
- [The action log](#the-action-log)
- [Constants](#constants)

## GameState shape

Sent whole, every time, on `game_started` and `state_update`. There is no partial/diff
update — always replace your local copy with the payload.

```ts
interface GameState {
  players: Player[];
  bank: TokenPool;                        // tokens available to take
  tableCards: Record<TierKey, Card[]>;    // 4 face-up cards per tier (tier1|tier2|tier3)
  decks: Record<TierKey, Card[]>;         // face-down piles, index 0 = top. Full contents
                                           // are sent — see "Notes" in the README.
  nobles: Noble[];
  currentPlayerIndex: number;
  turnCount: number;
  status: 'waiting' | 'playing' | 'finished';
  winnerId: string | null;
  finalRoundTriggered: boolean;           // true once someone hit 15+ points
  finalRoundStartIndex: number | null;    // seat the final round must return to
  pendingDiscard: PendingDiscard | null;  // set when a player must discard down to 10
  log: LogEntry[];                        // full history, oldest first — see below
}

interface Player {
  id: string;
  name: string;
  tokens: TokenPool;
  cardsOwned: Card[];
  reservedCards: Card[];
  points: number;
}

interface Card {
  id: string;
  tier: 1 | 2 | 3;
  cost: Cost;        // per-colour price, gold excluded
  bonus: Color;       // the discount colour this card grants once owned
  points: number;
}

interface Noble {
  id: string;
  requirement: Cost;  // card-bonus counts needed to attract this noble
  points: number;      // always 3
}

interface PendingDiscard {
  playerId: string;
  excess: number;      // how many tokens must be handed back
}

type Color = 'emerald' | 'sapphire' | 'ruby' | 'diamond' | 'onyx';
type TokenColor = Color | 'gold';
type Cost = Record<Color, number>;
type TokenPool = Record<TokenColor, number>;
```

**Turn ownership**: the acting player is always `players[currentPlayerIndex]`. Disable
action controls for everyone else, but note `pendingDiscard` overrides this — while it
is set, only `pendingDiscard.playerId` may act, and only with `discard_tokens` (see
below), even if it's still nominally someone else's `currentPlayerIndex`.

## Actions

Send via `player_action: {roomId, action}`. On success the server broadcasts
`state_update` to the room; on failure it emits `action_error: {error}` to the sender
only — nothing changes and nothing broadcasts.

### `take_three_different`

```ts
{ type: 'take_three_different', colors: Color[] }
```

Take one token of each listed colour. 1, 2, or 3 distinct colours are all legal — you
are not required to take three even when three or more are available in the bank.
Every listed colour must have at least 1 token in the bank. Gold cannot be taken this
way.

### `take_two_same`

```ts
{ type: 'take_two_same', color: Color }
```

Take two tokens of one colour. Legal only while the bank has **4 or more** of that
colour (`TAKE_TWO_MIN_IN_BANK`) — this is why a colour down to 1-3 left can still only
be taken via `take_three_different`, one at a time.

### `reserve_card`

```ts
{ type: 'reserve_card', cardId: string }               // a face-up card
{ type: 'reserve_card', tier: 1 | 2 | 3, fromDeck: true } // blind, top of a deck
```

Moves the card to `reservedCards` and grants 1 gold if the bank has any (an empty gold
pile does not block the reservation — you just get no gold). Rejected once a player
already has 3 reserved cards, or the target deck is empty (blind reserve only).

### `buy_card`

```ts
{ type: 'buy_card', cardId: string, fromReserved?: boolean }
```

`fromReserved: true` looks in the player's own `reservedCards`; otherwise the card must
be one of the face-up `tableCards`. Cost is `card.cost` minus the player's card-bonus
discounts (see `bonus` on owned cards), gold acting as a wildcard for whatever gem
tokens don't cover. Rejected if the player can't cover the cost even with all their
gold.

### `discard_tokens`

```ts
{ type: 'discard_tokens', tokensToDiscard: Partial<TokenPool> }
```

**Only accepted while `pendingDiscard` is set, and only from `pendingDiscard.playerId`.**
Ending a turn with more than 10 tokens held freezes the game on this player — no one,
including them, can do anything else until they discard. The amounts must sum to
exactly `pendingDiscard.excess` and must not exceed what the player actually holds.

## Error codes

Carried on `action_error.error` (or on direct-callback failures for lobby/room events)
as a stable string, never prose. Full source: [`../src/engine/errors.ts`](../src/engine/errors.ts)
(game actions) and [`../src/socket/errors.ts`](../src/socket/errors.ts) (room/lobby).

| Code | Meaning |
|---|---|
| `GAME_NOT_PLAYING` | Game hasn't started or has already finished |
| `NOT_YOUR_TURN` | Someone else's `currentPlayerIndex` |
| `UNKNOWN_PLAYER` | `playerId` not seated in this game |
| `UNKNOWN_ACTION` | `action.type` not recognised |
| `DISCARD_REQUIRED` | A discard is pending — from this player or another; no other action accepted |
| `NO_DISCARD_PENDING` | Sent `discard_tokens` with nothing owed |
| `DISCARD_WRONG_AMOUNT` | Discarded amounts don't sum to exactly the owed excess |
| `DISCARD_TOKENS_NOT_HELD` | Tried to discard more of a colour than the player holds |
| `INVALID_COLOR` | Not one of the 5 gem colours (or gold, where gold is disallowed) |
| `NEED_THREE_DISTINCT_COLORS` | Empty list, duplicate colours, or more than 3 colours |
| `COLOR_NOT_AVAILABLE` | Bank has 0 of a requested colour |
| `NOT_ENOUGH_IN_BANK_FOR_TWO` | Bank has fewer than 4 of the requested colour |
| `RESERVE_LIMIT_REACHED` | Player already has 3 reserved cards |
| `DECK_EMPTY` | Blind reserve from an empty tier deck |
| `CARD_NOT_ON_TABLE` | `cardId` isn't currently face-up |
| `INVALID_TIER` | Tier isn't 1, 2, or 3 |
| `CARD_NOT_FOUND` | `cardId` doesn't exist / payload malformed |
| `CARD_NOT_RESERVED` | `fromReserved: true` but the card isn't in the player's reserve |
| `INSUFFICIENT_RESOURCES` | Can't cover the card's cost even with all gold |

## The action log

`gameState.log` is the full history of what happened, oldest first, included in every
`state_update`/`game_started` broadcast — no separate event to subscribe to. Each entry
is structured data, not a pre-built sentence: the frontend renders the text (and can
localise it) from the typed fields.

```ts
type LogEntry = { id: string; timestamp: number } & (
  | { type: 'take_three_different'; playerId: string; colors: Color[] }
  | { type: 'take_two_same'; playerId: string; color: Color; count: 2 }
  | { type: 'reserve_card'; playerId: string; card: Card; tookGold: boolean; fromDeck: boolean }
  | { type: 'buy_card'; playerId: string; card: Card; fromReserved: boolean }
  | { type: 'discard_tokens'; playerId: string; tokens: Partial<TokenPool> }
  | { type: 'noble_visit'; playerId: string; noble: Noble }
  | { type: 'game_over'; winnerId: string | null }
);
```

Notes:
- One player action can produce more than one entry — e.g. buying a card that also
  attracts a noble appends `buy_card` then `noble_visit`, in that order.
- `noble_visit` and `game_over` are synthetic: they aren't sent by the client as
  actions, the server appends them automatically when they happen.
- A rejected action (any `action_error`) never appends anything — the log only grows on
  success.
- The log is never trimmed; it holds the whole game. Cap how much you render if a match
  runs long, the server won't do it for you.
- `id` is a UUID, safe to use as a React `key`. `timestamp` is `Date.now()` in
  milliseconds, server clock.

## Constants

Not sent over the wire — bake these in on the frontend, or treat them as documentation
for why an action was rejected. Source: [`../src/engine/constants.ts`](../src/engine/constants.ts).

| Constant | Value | Meaning |
|---|---|---|
| `WINNING_POINTS` | 15 | Score that arms the final round |
| `MAX_TOKENS` | 10 | Tokens a player may hold at end of turn before a discard is forced |
| `MAX_RESERVED` | 3 | Reserved cards a player may hold at once |
| `TABLE_SLOTS` | 4 | Face-up cards per tier |
| `TAKE_TWO_MIN_IN_BANK` | 4 | Bank minimum to legally `take_two_same` a colour |
| `TAKE_THREE_COUNT` | 3 | Max distinct colours per `take_three_different` |
| `MIN_PLAYERS` / `MAX_PLAYERS` | 2 / 4 | Seats per room |
| `GOLD_COUNT` | 5 | Gold in the bank, fixed regardless of player count |
| `BANK_PER_PLAYER_COUNT` | `{2:4, 3:5, 4:7}` | Starting gems per colour, by seat count |
| `NOBLES_PER_PLAYER_OFFSET` | 1 | Nobles dealt = players + 1 |
| `NOBLE_POINTS` | 3 | Points every noble is worth |
