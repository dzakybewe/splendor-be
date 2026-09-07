/**
 * Single source of truth for the game shape and the Socket.IO wire contract.
 * The frontend repo can consume this file directly for end-to-end type safety.
 */

// ---------------------------------------------------------------------------
// Colours and tokens
// ---------------------------------------------------------------------------

/** The five gem colours. Cards have a cost and a bonus in these; gold is never either. */
export const COLORS = ['emerald', 'sapphire', 'ruby', 'diamond', 'onyx'] as const;
export type Color = (typeof COLORS)[number];

/** Everything that can sit in the bank or a player's hand — the five gems plus gold. */
export const TOKEN_COLORS = [...COLORS, 'gold'] as const;
export type TokenColor = (typeof TOKEN_COLORS)[number];

/** A count per gem colour. Card costs and noble requirements use this; gold is excluded. */
export type Cost = Record<Color, number>;

/** A count per token colour, gold included. Used for the bank and player hands. */
export type TokenPool = Record<TokenColor, number>;

export type Tier = 1 | 2 | 3;
export type TierKey = 'tier1' | 'tier2' | 'tier3';
export const TIER_KEYS = ['tier1', 'tier2', 'tier3'] as const;

// ---------------------------------------------------------------------------
// Cards, nobles, players
// ---------------------------------------------------------------------------

export interface Card {
  id: string;
  tier: Tier;
  cost: Cost;
  bonus: Color;
  points: number;
}

export interface Noble {
  id: string;
  /** Number of card bonuses of each colour required to attract this noble. */
  requirement: Cost;
  points: number;
}

export interface Player {
  id: string;
  name: string;
  tokens: TokenPool;
  cardsOwned: Card[];
  reservedCards: Card[];
  points: number;
}

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------

export type GameStatus = 'waiting' | 'playing' | 'finished';

/**
 * Set when an action leaves a player holding more than MAX_TOKENS. The turn does not
 * advance and no other action from that player is accepted until they discard down.
 */
export interface PendingDiscard {
  playerId: string;
  /** How many tokens must be discarded to get back to the limit. */
  excess: number;
}

export interface GameState {
  players: Player[];
  bank: TokenPool;
  /** The four face-up cards per tier. */
  tableCards: Record<TierKey, Card[]>;
  /** Remaining face-down draw piles, index 0 is the top. */
  decks: Record<TierKey, Card[]>;
  nobles: Noble[];
  currentPlayerIndex: number;
  turnCount: number;
  status: GameStatus;
  winnerId: string | null;

  /** True once someone has reached the winning score; the round is played out to the end. */
  finalRoundTriggered: boolean;
  /** Player index the final round must return to before the game ends. */
  finalRoundStartIndex: number | null;
  pendingDiscard: PendingDiscard | null;
  /** Chronological feed of what happened, oldest first. The client renders the text. */
  log: LogEntry[];
}

// ---------------------------------------------------------------------------
// Activity log
// ---------------------------------------------------------------------------

/**
 * One event for the client to render as a line in the game log. Structured rather than
 * a pre-built message so the frontend controls wording and localisation.
 */
export type LogEntry = { id: string; timestamp: number } & (
  | { type: 'take_three_different'; playerId: string; colors: Color[] }
  | { type: 'take_two_same'; playerId: string; color: Color; count: 2 }
  | { type: 'reserve_card'; playerId: string; card: Card; tookGold: boolean; fromDeck: boolean }
  | { type: 'buy_card'; playerId: string; card: Card; fromReserved: boolean }
  | { type: 'discard_tokens'; playerId: string; tokens: Partial<TokenPool> }
  | { type: 'noble_visit'; playerId: string; noble: Noble }
  | { type: 'game_over'; winnerId: string | null }
);

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export interface TakeThreeDifferentPayload {
  /** Readonly so callers can pass a literal tuple without widening it first. */
  colors: readonly Color[];
}

export interface TakeTwoSamePayload {
  color: Color;
}

export type ReserveCardPayload =
  | { cardId: string; fromDeck?: false }
  | { tier: Tier; fromDeck: true };

export interface BuyCardPayload {
  cardId: string;
  fromReserved?: boolean;
}

export interface DiscardExcessTokensPayload {
  tokensToDiscard: Partial<TokenPool>;
}

/** What a client sends inside `player_action`. */
export type PlayerAction =
  | ({ type: 'take_three_different' } & TakeThreeDifferentPayload)
  | ({ type: 'take_two_same' } & TakeTwoSamePayload)
  | ({ type: 'reserve_card' } & ReserveCardPayload)
  | ({ type: 'buy_card' } & BuyCardPayload)
  | ({ type: 'discard_tokens' } & DiscardExcessTokensPayload);

export type ActionType = PlayerAction['type'];

/**
 * Every engine action returns this. A discriminated union, so callers cannot read
 * `gameState` without first proving `success` is true.
 */
export type ActionResult =
  | { success: true; gameState: GameState; error?: undefined }
  | { success: false; error: string; gameState?: undefined };

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

/** A seat in a room. `playerId` is stable across reconnects; `socketId` is not. */
export interface RoomPlayer {
  playerId: string;
  name: string;
  socketId: string | null;
  connected: boolean;
  isHost: boolean;
}

export interface Room {
  roomId: string;
  hostPlayerId: string;
  players: RoomPlayer[];
  gameState: GameState | null;
  /** Cleanup timer, armed only while every seat is disconnected. */
  emptySinceTimer: NodeJS.Timeout | null;
}

// ---------------------------------------------------------------------------
// Socket.IO contract
// ---------------------------------------------------------------------------

export interface CreateRoomPayload {
  name: string;
}
export interface JoinRoomPayload {
  roomId: string;
  name: string;
}
export interface StartGamePayload {
  roomId: string;
}
export interface PlayerActionPayload {
  roomId: string;
  action: PlayerAction;
}
export interface RejoinRoomPayload {
  roomId: string;
  name: string;
}

/** Seat info safe to broadcast — no socket ids. */
export interface PlayerListEntry {
  playerId: string;
  name: string;
  connected: boolean;
  isHost: boolean;
}

export interface ClientToServerEvents {
  create_room: (payload: CreateRoomPayload) => void;
  join_room: (payload: JoinRoomPayload) => void;
  start_game: (payload: StartGamePayload) => void;
  player_action: (payload: PlayerActionPayload) => void;
  rejoin_room: (payload: RejoinRoomPayload) => void;
}

export interface ServerToClientEvents {
  room_created: (payload: { roomId: string; playerId: string; players: PlayerListEntry[] }) => void;
  room_joined: (payload: { roomId: string; playerId: string; players: PlayerListEntry[] }) => void;
  player_list_update: (payload: { roomId: string; players: PlayerListEntry[] }) => void;
  game_started: (payload: { roomId: string; gameState: GameState }) => void;
  state_update: (payload: { roomId: string; gameState: GameState }) => void;
  action_error: (payload: { error: string }) => void;
}

/** Per-socket state the server keeps, so `disconnect` knows which seat to mark. */
export interface SocketData {
  roomId: string | null;
  playerId: string | null;
}
