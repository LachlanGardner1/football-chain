import { DailyPuzzleService } from "../services/daily/daily-puzzle.service";
import { ChainValidationService } from "../services/game/chain-validation.service";
import { GraphBootstrapService } from "../services/graph/graph-bootstrap.service";
import { InMemoryGraphService } from "../services/graph/in-memory-graph.service";
import { ResultService } from "../services/results/result.service";
import { PgDailyPuzzleRepository } from "../repositories/postgres/daily-puzzle.repository";
import { PgGameResultRepository } from "../repositories/postgres/game-result.repository";
import { PgGraphRepository } from "../repositories/postgres/graph.repository";

const dailyPuzzleRepo = new PgDailyPuzzleRepository();
const gameResultRepo = new PgGameResultRepository();
const graphRepo = new PgGraphRepository();
const graph = new InMemoryGraphService();
const graphBootstrap = new GraphBootstrapService(graphRepo, graph);

let bootPromise: Promise<void> | null = null;

export async function ensureServicesReady(): Promise<void> {
  if (!bootPromise) {
    bootPromise = graphBootstrap.ensureLoaded();
  }

  try {
    await bootPromise;
  } catch (error) {
    bootPromise = null;
    throw error;
  }
}

export const services = {
  dailyPuzzle: new DailyPuzzleService(dailyPuzzleRepo),
  chainValidation: new ChainValidationService(graph),
  results: new ResultService(gameResultRepo),
};
