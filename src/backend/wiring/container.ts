import { DailyPuzzleService } from "../services/daily/daily-puzzle.service";
import { ChainValidationService } from "../services/game/chain-validation.service";
import { SpeedRoundChainValidator } from "../services/game/speed-round-validation.service";
import { PgGraphService } from "../services/graph/pg-graph.service";
import { HintService } from "../services/hints/hint.service";
import { LeaderboardService } from "../services/leaderboard/leaderboard.service";
import { ResultService } from "../services/results/result.service";
import { SpeedRoundService } from "../services/speed-round/speed-round.service";
import { UserProfileService } from "../services/users/user-profile.service";
import { PgDailyPuzzleRepository } from "../repositories/postgres/daily-puzzle.repository";
import { PgGameResultRepository } from "../repositories/postgres/game-result.repository";
import { PgGraphRepository } from "../repositories/postgres/graph.repository";
import { PgHintRepository } from "../repositories/postgres/hint.repository";
import { PgLeaderboardRepository } from "../repositories/postgres/leaderboard.repository";
import { PgSpeedRoundRepository } from "../repositories/postgres/speed-round.repository";
import { PgUserRepository } from "../repositories/postgres/user.repository";

const dailyPuzzleRepo = new PgDailyPuzzleRepository();
const gameResultRepo = new PgGameResultRepository();
const graphRepo = new PgGraphRepository();
const hintRepo = new PgHintRepository();
const speedRoundRepo = new PgSpeedRoundRepository();
const leaderboardRepo = new PgLeaderboardRepository();
const userRepo = new PgUserRepository();
const graph = new PgGraphService(graphRepo);

export const services = {
  dailyPuzzle: new DailyPuzzleService(dailyPuzzleRepo),
  chainValidation: new ChainValidationService(graph),
  results: new ResultService(gameResultRepo),
  hints: new HintService(hintRepo, graph, graphRepo),
  speedRound: new SpeedRoundService(speedRoundRepo, new SpeedRoundChainValidator(graph)),
  leaderboard: new LeaderboardService(leaderboardRepo),
  userProfile: new UserProfileService(userRepo),
};
