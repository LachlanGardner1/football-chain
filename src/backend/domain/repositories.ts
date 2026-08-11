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
