import type {
  ChainNodeInput,
  DailyPuzzle,
  DailyPuzzleDTO,
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
  upsertAttempt(params: {
    userId: string;
    puzzleId: number;
    solved: boolean;
    chainLength?: number;
  }): Promise<void>;

  getUserStats(userId: string): Promise<UserStatsDTO>;
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
