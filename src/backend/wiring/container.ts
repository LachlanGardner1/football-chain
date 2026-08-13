import { DailyPuzzleService } from "../services/daily/daily-puzzle.service";
import { ChainValidationService } from "../services/game/chain-validation.service";
import { SpeedRoundChainValidator } from "../services/game/speed-round-validation.service";
import { PgGraphService } from "../services/graph/pg-graph.service";
import { HintService } from "../services/hints/hint.service";
import { ResultService } from "../services/results/result.service";
import { SpeedRoundService } from "../services/speed-round/speed-round.service";
import { PgDailyPuzzleRepository } from "../repositories/postgres/daily-puzzle.repository";
import { PgGameResultRepository } from "../repositories/postgres/game-result.repository";
import { PgGraphRepository } from "../repositories/postgres/graph.repository";
import { PgHintRepository } from "../repositories/postgres/hint.repository";
import { PgSpeedRoundRepository } from "../repositories/postgres/speed-round.repository";

const dailyPuzzleRepo = new PgDailyPuzzleRepository();
const gameResultRepo = new PgGameResultRepository();
const graphRepo = new PgGraphRepository();
const hintRepo = new PgHintRepository();
const speedRoundRepo = new PgSpeedRoundRepository();
const graph = new PgGraphService(graphRepo);

export const services = {
  dailyPuzzle: new DailyPuzzleService(dailyPuzzleRepo),
  chainValidation: new ChainValidationService(graph),
  results: new ResultService(gameResultRepo),
  hints: new HintService(hintRepo, graph, graphRepo),
  speedRound: new SpeedRoundService(speedRoundRepo, new SpeedRoundChainValidator(graph)),
};
