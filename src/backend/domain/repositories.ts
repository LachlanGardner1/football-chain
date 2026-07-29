import type {
  ChainNodeInput,
  DailyPuzzle,
  DailyPuzzleDTO,
  UserStatsDTO,
  ValidationResult,
} from "./types";

export interface DailyPuzzleRepository {
  getPublishedPuzzleByDate(date: string): Promise<DailyPuzzleDTO | null>;
  getPuzzleById(puzzleId: number): Promise<DailyPuzzle | null>;
}

export interface GraphRepository {
  getActiveDatasetVersionId(): Promise<number>;
  loadPlayerClubEdges(datasetVersionId: number): Promise<Array<{ playerId: number; clubId: number }>>;
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
    startPlayerId: number;
    targetPlayerId: number;
  }): Promise<ValidationResult>;
}
