import type { ChainValidator, SpeedRoundRepository } from "../../domain/repositories";
import type {
  ChainNodeInput,
  SpeedRoundCreateResultDTO,
  SpeedRoundJoinResult,
  SpeedRoundMatchStateDTO,
  ValidationResult,
} from "../../domain/types";

export class SpeedRoundService {
  constructor(
    private readonly repo: SpeedRoundRepository,
    private readonly validator: ChainValidator,
  ) {}

  async createMatch(userId: string): Promise<SpeedRoundCreateResultDTO> {
    return this.repo.createMatch(userId);
  }

  async joinMatch(inviteCode: string, userId: string): Promise<SpeedRoundJoinResult> {
    return this.repo.joinMatch(inviteCode, userId);
  }

  async markReady(matchId: number, userId: string): Promise<void> {
    await this.repo.markReady(matchId, userId);
  }

  async getMatchState(matchId: number, userId: string): Promise<SpeedRoundMatchStateDTO> {
    return this.repo.getMatchState(matchId, userId);
  }

  // Fetching state first (rather than a lighter "just the anchors" lookup) isn't wasted work -
  // it doubles as this submission's heartbeat/presence proof and runs the same self-healing
  // status transitions every poll already does, so a player who's actively submitting links
  // never gets forfeited out from under themselves.
  async submit(matchId: number, userId: string, chain: ChainNodeInput[]): Promise<ValidationResult> {
    const state = await this.repo.getMatchState(matchId, userId);

    if (state.status === "WAITING_FOR_OPPONENT" || state.status === "READY_COUNTDOWN" || state.status === "CANCELLED") {
      return { valid: false, solved: false, reason: "The race hasn't started yet." };
    }

    const anchorPlayerIds = state.anchorPlayers.map((player) => player.id);
    const result = await this.validator.validateChain({ chain, anchorPlayerIds });

    // Status FINISHED is allowed through here deliberately - a player who didn't finish first
    // can still submit afterward to record their own chain/time for the summary screen; see
    // SpeedRoundRepository.recordFinish for why that's safe (first-write-wins per player slot,
    // doesn't disturb who won).
    if (result.solved) {
      await this.repo.recordFinish({ matchId, userId, chain });
    }

    return result;
  }
}
