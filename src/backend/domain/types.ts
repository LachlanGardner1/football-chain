export type NodeType = "PLAYER" | "CLUB";

export interface DataVersion {
  id: number;
  versionKey: string;
}

export interface Player {
  id: number;
  canonicalName: string;
  normalizedName: string;
}

export interface Club {
  id: number;
  canonicalName: string;
  normalizedName: string;
}

export interface DailyPuzzle {
  id: number;
  puzzleDate: string;
  anchorPlayerIds: number[];
  optimalLength: number;
  datasetVersionId: number;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
}

export interface ChainNodeInput {
  id: number;
  type: NodeType;
}

export interface ValidationResult {
  valid: boolean;
  solved: boolean;
  reason?: string;
  chainLength?: number;
}

export interface DailyPuzzleDTO {
  puzzleId: number;
  date: string;
  anchorPlayers: Array<{ id: number; name: string }>;
  optimalLength?: number;
}

export interface UserStatsDTO {
  solvedCount: number;
  currentStreak: number;
  maxStreak: number;
  bestChainLength: number | null;
}

// A puzzle's outcome locks in on the first time a player either solves it or runs their
// score to 0 - see GameResultRepository.upsertAttempt. Replaying afterward never changes
// solved/bestChainLength/failedAt again for that (user, puzzle) pair.
export interface PuzzleOutcomeDTO {
  outcomeLocked: boolean;
  solved: boolean;
  failedAt: string | null;
  bestChainLength: number | null;
  lockedScore: number | null;
}

// --- Speed round (1v1 real-time race mode) ---

export type SpeedRoundMatchStatus =
  | "WAITING_FOR_OPPONENT"
  | "READY_COUNTDOWN"
  | "IN_PROGRESS"
  | "FINISHED"
  | "CANCELLED";

// Which of the match's two fixed player slots the calling session occupies - see
// speed_round_matches' player_a_*/player_b_* columns. Never exposed as "a"/"b" beyond this -
// the API/UI only ever talks about "you" vs. "opponent".
export type SpeedRoundPlayerSlot = "a" | "b";

export interface SpeedRoundCreateResultDTO {
  matchId: number;
  inviteCode: string;
}

// "JOINED" covers filling the open slot AND the idempotent case of a caller who's already one
// of the two players (including the creator revisiting their own match) - the frontend always
// resolves the invite code to a matchId via this same call on page load, so both the creator's
// own load and a real second player's join go through one code path.
export type SpeedRoundJoinResult =
  | { kind: "JOINED"; matchId: number }
  | { kind: "NOT_FOUND" }
  | { kind: "FULL" };

// Polled roughly every 1s once IN_PROGRESS - the state machine is entirely self-healing off
// this read path (READY_COUNTDOWN -> IN_PROGRESS once startedAt has passed, and the
// finished-but-opponent-went-quiet forfeit rule), so there's no separate "start match" or
// "resolve forfeit" endpoint.
export interface SpeedRoundMatchStateDTO {
  matchId: number;
  inviteCode: string;
  status: SpeedRoundMatchStatus;
  anchorPlayers: Array<{ id: number; name: string }>;
  startedAt: string | null;
  you: SpeedRoundPlayerSlot;
  opponentPresent: boolean;
  youReady: boolean;
  opponentReady: boolean;
  youFinishedAt: string | null;
  opponentFinishedAt: string | null;
  youChain: ChainNodeInput[] | null;
  opponentChain: ChainNodeInput[] | null;
  // "you" | "opponent" once decided, else null - forfeitedSlot mirrors this to distinguish a
  // normal loss (opponent finished first) from a win/loss by forfeit (opponent's heartbeat
  // went stale before finishing).
  winner: "you" | "opponent" | null;
  opponentForfeited: boolean;
}
