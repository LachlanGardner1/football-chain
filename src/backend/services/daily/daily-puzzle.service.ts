import type { DailyPuzzleRepository } from "../../domain/repositories";
import type { DailyPuzzleDTO } from "../../domain/types";

export class DailyPuzzleService {
  constructor(private readonly dailyPuzzleRepo: DailyPuzzleRepository) {}

  async getTodayPublishedPuzzle(dateIso: string, options?: { strict?: boolean }): Promise<DailyPuzzleDTO | null> {
    return this.dailyPuzzleRepo.getPublishedPuzzleByDate(dateIso, options);
  }

  async getPublishedDates(): Promise<{ dates: string[]; today: string }> {
    return this.dailyPuzzleRepo.getPublishedDates();
  }

  async getAnchorPlayers(puzzleId: number): Promise<Array<{ id: number; name: string }>> {
    return this.dailyPuzzleRepo.getAnchorPlayers(puzzleId);
  }
}
