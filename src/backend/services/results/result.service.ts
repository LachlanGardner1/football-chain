import type { GameResultRepository } from "../../domain/repositories";
import type { PuzzleOutcomeDTO, UserStatsDTO } from "../../domain/types";

export class ResultService {
  constructor(private readonly gameResultRepo: GameResultRepository) {}

  async recordAttempt(params: {
    userId: string;
    puzzleId: number;
    outcome: "SOLVED" | "FAILED";
    chainLength?: number;
    score: number;
  }): Promise<void> {
    await this.gameResultRepo.upsertAttempt(params);
  }

  async getUserStats(userId: string): Promise<UserStatsDTO> {
    return this.gameResultRepo.getUserStats(userId);
  }

  async getOutcome(userId: string, puzzleId: number): Promise<PuzzleOutcomeDTO> {
    return this.gameResultRepo.getOutcome(userId, puzzleId);
  }
}
