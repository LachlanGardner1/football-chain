import { DailyPuzzleService } from "../services/daily/daily-puzzle.service";
import { ChainValidationService } from "../services/game/chain-validation.service";
import { PgGraphService } from "../services/graph/pg-graph.service";
import { ResultService } from "../services/results/result.service";
import { PgDailyPuzzleRepository } from "../repositories/postgres/daily-puzzle.repository";
import { PgGameResultRepository } from "../repositories/postgres/game-result.repository";
import { PgGraphRepository } from "../repositories/postgres/graph.repository";

const dailyPuzzleRepo = new PgDailyPuzzleRepository();
const gameResultRepo = new PgGameResultRepository();
const graphRepo = new PgGraphRepository();
const graph = new PgGraphService(graphRepo);

export const services = {
  dailyPuzzle: new DailyPuzzleService(dailyPuzzleRepo),
  chainValidation: new ChainValidationService(graph),
  results: new ResultService(gameResultRepo),
};
