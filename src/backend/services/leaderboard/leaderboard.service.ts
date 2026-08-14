import type { LeaderboardRepository } from "../../domain/repositories";
import type { DailyLeaderboardDTO, DuelPlayerDetailDTO, DuelRankingEntryDTO } from "../../domain/types";

export class LeaderboardService {
  constructor(private readonly repo: LeaderboardRepository) {}

  async getDailyLeaderboard(date: string | null, viewerUserId: string): Promise<DailyLeaderboardDTO> {
    return this.repo.getDailyLeaderboard(date, viewerUserId);
  }

  async getDuelRankings(): Promise<DuelRankingEntryDTO[]> {
    return this.repo.getDuelRankings();
  }

  async getDuelPlayerDetail(userId: string): Promise<DuelPlayerDetailDTO | null> {
    return this.repo.getDuelPlayerDetail(userId);
  }
}
