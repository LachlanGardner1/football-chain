import type {
  ChainNodeInput,
  DailyLeaderboardDTO,
  DailyPuzzle,
  DailyPuzzleDTO,
  DuelPlayerDetailDTO,
  DuelRankingEntryDTO,
  PuzzleOutcomeDTO,
  SpeedRoundCreateResultDTO,
  SpeedRoundJoinResult,
  SpeedRoundMatchStateDTO,
  UserStatsDTO,
  ValidationResult,
} from "./types";

export interface DailyPuzzleRepository {
  getPublishedPuzzleByDate(date: string, options?: { strict?: boolean }): Promise<DailyPuzzleDTO | null>;
  getPuzzleById(puzzleId: number): Promise<DailyPuzzle | null>;
  getPublishedDates(): Promise<{ dates: string[]; today: string }>;
  // Alphabetically ordered - the hint flow relies on this being a stable order (which anchor
  // gets hinted first) that matches how the UI already sorts anchor chips.
  getAnchorPlayers(puzzleId: number): Promise<Array<{ id: number; name: string }>>;
}

export interface GraphRepository {
  getActiveDatasetVersionId(): Promise<number>;
  loadPlayerClubEdges(datasetVersionId: number): Promise<Array<{ playerId: number; clubId: number; playerName?: string; clubName?: string }>>;
  hasPlayerClubEdge(datasetVersionId: number, playerId: number, clubId: number): Promise<boolean>;
  getPlayerName(playerId: number): Promise<string | null>;
  getClubName(clubId: number): Promise<string | null>;
}

export interface GameResultRepository {
  // The first call for a given (userId, puzzleId) locks in solved/best_chain_length/
  // solved_at/failed_at permanently and (if SOLVED, and it's today's puzzle) refreshes the
  // streak. Every later call for the same pair only increments the attempts counter - a
  // player can keep replaying for fun without ever changing that day's recorded result.
  upsertAttempt(params: {
    userId: string;
    puzzleId: number;
    outcome: "SOLVED" | "FAILED";
    chainLength?: number;
    score: number;
  }): Promise<void>;

  getUserStats(userId: string): Promise<UserStatsDTO>;

  // Read-only - used to hydrate the UI with whatever the locked-in outcome already is (e.g.
  // after a refresh, or returning to a puzzle already played earlier).
  getOutcome(userId: string, puzzleId: number): Promise<PuzzleOutcomeDTO>;
}

export interface ChainValidator {
  validateChain(params: {
    chain: ChainNodeInput[];
    anchorPlayerIds: number[];
  }): Promise<ValidationResult>;
}

export interface RevealedAnchorClubHint {
  anchorPlayerId: number;
  clubId: number;
  clubName: string;
}

export interface HintRepository {
  getRevealedAnchorClubHints(userId: string, puzzleId: number): Promise<RevealedAnchorClubHint[]>;
  // Longest-tenure-first, excluding clubs already revealed for this anchor - null once every
  // club that player has played for has been revealed.
  getNextUnrevealedClub(
    playerId: number,
    datasetVersionId: number,
    excludeClubIds: number[],
  ): Promise<{ clubId: number; clubName: string } | null>;
  // Ensures users/game_results rows exist (a hint can be the very first thing a player does,
  // before any /api/complete call), inserts the reveal (no-op on a race/repeat), and bumps
  // the generic hints_used counter.
  recordAnchorClubHint(params: {
    userId: string;
    puzzleId: number;
    anchorPlayerId: number;
    clubId: number;
  }): Promise<void>;
  // Ensures users/game_results rows exist, bumps next_step_hints_used (and the generic
  // hints_used counter), returns the new next_step_hints_used count.
  incrementNextStepHints(userId: string, puzzleId: number): Promise<number>;
  // Read-only (no upsert) - used to hydrate hint state on page load, e.g. after a refresh.
  getNextStepHintsUsed(userId: string, puzzleId: number): Promise<number>;
}

export interface SpeedRoundRepository {
  // Claims a pool puzzle (see scripts/puzzle-generation/generate-speed-round-pool.ts - never
  // generates one inline, only picks an existing row), creates the match row with a fresh
  // invite code, and ensures a users row exists for the creator.
  createMatch(creatorUserId: string): Promise<SpeedRoundCreateResultDTO>;

  // Ensures a users row exists for the joiner, then fills the match's open player slot.
  joinMatch(inviteCode: string, joinerUserId: string): Promise<SpeedRoundJoinResult>;

  // Marks the calling player's slot ready; once both slots are ready, sets started_at to 5
  // seconds out. A no-op (not an error) if already ready.
  markReady(matchId: number, userId: string): Promise<void>;

  // The polling read: resolves any due state transitions first (READY_COUNTDOWN ->
  // IN_PROGRESS once startedAt has passed; a finished-but-opponent-gone-quiet match to a
  // forfeit win), records the caller's heartbeat, then returns state from the caller's point
  // of view (never exposes which literal slot - "a"/"b" - is which). Throws if userId isn't
  // one of this match's two players.
  getMatchState(matchId: number, userId: string): Promise<SpeedRoundMatchStateDTO>;

  // Called only once SpeedRoundChainValidator has confirmed a submission is a valid, complete
  // solve. Records the caller's own finish - first-write-wins per slot (a second submission
  // from the same slot after it's already recorded a finish is a no-op) - and, if this is the
  // first finish recorded for the match at all, sets the winner and flips status to FINISHED.
  // A losing player may still call this afterward purely to record their own chain/time for
  // the summary screen.
  recordFinish(params: { matchId: number; userId: string; chain: ChainNodeInput[] }): Promise<void>;
}

export interface LeaderboardRepository {
  // requestedDate: raw client-supplied YYYY-MM-DD, or null meaning "today". "Today" and the
  // lock check are both resolved against the DB's own (now() AT TIME ZONE 'Australia/Sydney')
  // ::date, never a JS Date - see db/migrations/017's history for why trusting any server-local
  // clock (or session-level timezone state) for "today" is exactly the bug class to avoid.
  getDailyLeaderboard(requestedDate: string | null, viewerUserId: string): Promise<DailyLeaderboardDTO>;
  getDuelRankings(): Promise<DuelRankingEntryDTO[]>;
  getDuelPlayerDetail(userId: string): Promise<DuelPlayerDetailDTO | null>;
}

export interface UserRepository {
  // Ensures a users row exists (same ensureUser-style upsert used by every other repository
  // that needs one), then sets display_name. Caller (UserProfileService) validates trim/length.
  setDisplayName(userId: string, displayName: string): Promise<void>;
}
