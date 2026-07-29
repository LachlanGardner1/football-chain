import type { GameResultRepository } from "../../domain/repositories";
import type { UserStatsDTO } from "../../domain/types";

export class ResultService {
  constructor(private readonly gameResultRepo: GameResultRepository) {}

  async recordAttempt(params: {
    userId: string;
    puzzleId: number;
    solved: boolean;
    chainLength?: number;
  }): Promise<void> {
    await this.gameResultRepo.upsertAttempt(params);
  }

  async getUserStats(userId: string): Promise<UserStatsDTO> {
    return this.gameResultRepo.getUserStats(userId);
  }
}
