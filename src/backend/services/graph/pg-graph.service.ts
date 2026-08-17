import type { GraphRepository } from "../../domain/repositories";
import type { GraphNode, GraphService } from "./graph-types";
import { fromNodeId, toNodeId } from "./graph-types";

// Rebuilding the adjacency map means a full scan of player_clubs (500k+ rows) plus two joins -
// cheap once, but revealNextSteps calls shortestPathAvoiding once per unvisited anchor (up to
// O(n^2) when no chain steps are confirmed yet, see hint.service.ts), so a single hint click
// could otherwise trigger that scan several times over. Caching here (this instance is a
// module-level singleton per src/backend/wiring/container.ts, reused across warm invocations
// of the same Lambda the same way src/backend/repositories/postgres/db.ts's pgPool is) means
// only the first buildAdjacency() call per warm instance (or per cache expiry) pays that cost.
// Keyed by datasetVersionId so a real dataset-version change invalidates it automatically; the
// TTL on top is insurance against corrective migrations that UPDATE player_clubs/clubs rows in
// place without bumping dataset_version_id (this repo has two precedents for that:
// db/migrations/007_merge_duplicate_clubs.sql and 020_merge_duplicate_club_name_variants.sql).
const ADJACENCY_CACHE_TTL_MS = 15 * 60 * 1000;

export class PgGraphService implements GraphService {
  private adjacencyCache: { datasetVersionId: number; adjacency: Map<string, Set<string>>; cachedAt: number } | null = null;

  constructor(private readonly graphRepository: GraphRepository) {}

  async hasEdge(a: GraphNode, b: GraphNode): Promise<boolean> {
    const player = a.type === "PLAYER" ? a : b.type === "PLAYER" ? b : null;
    const club = a.type === "CLUB" ? a : b.type === "CLUB" ? b : null;

    if (!player || !club) {
      return false;
    }

    const datasetVersionId = await this.graphRepository.getActiveDatasetVersionId();
    return this.graphRepository.hasPlayerClubEdge(datasetVersionId, player.id, club.id);
  }

  async getNodeName(node: GraphNode): Promise<string | null> {
    return node.type === "PLAYER"
      ? this.graphRepository.getPlayerName(node.id)
      : this.graphRepository.getClubName(node.id);
  }

  async shortestPathPlayerToPlayer(startPlayerId: number, targetPlayerId: number): Promise<GraphNode[] | null> {
    const start = toNodeId({ id: startPlayerId, type: "PLAYER" });
    const target = toNodeId({ id: targetPlayerId, type: "PLAYER" });

    if (start === target) {
      return [fromNodeId(start)];
    }

    const adjacency = await this.buildAdjacency();
    const path = bidirectionalBfs(adjacency, start, target);
    return path?.map(fromNodeId) ?? null;
  }

  async shortestPathAvoiding(from: GraphNode, targetPlayerId: number, excluded: GraphNode[]): Promise<GraphNode[] | null> {
    const start = toNodeId(from);
    const target = toNodeId({ id: targetPlayerId, type: "PLAYER" });

    if (start === target) {
      return [fromNodeId(start)];
    }

    const adjacency = await this.buildAdjacency();
    const excludedIds = new Set(excluded.map((node) => toNodeId(node)));
    const path = bidirectionalBfs(adjacency, start, target, excludedIds);
    return path?.map(fromNodeId) ?? null;
  }

  private async buildAdjacency(): Promise<Map<string, Set<string>>> {
    const datasetVersionId = await this.graphRepository.getActiveDatasetVersionId();

    const cache = this.adjacencyCache;
    if (cache && cache.datasetVersionId === datasetVersionId && Date.now() - cache.cachedAt < ADJACENCY_CACHE_TTL_MS) {
      return cache.adjacency;
    }

    const edges = await this.graphRepository.loadPlayerClubEdges(datasetVersionId);

    const adjacency = new Map<string, Set<string>>();
    for (const edge of edges) {
      connect(adjacency, { id: edge.playerId, type: "PLAYER" }, { id: edge.clubId, type: "CLUB" });
    }

    this.adjacencyCache = { datasetVersionId, adjacency, cachedAt: Date.now() };
    return adjacency;
  }
}

function connect(adjacency: Map<string, Set<string>>, a: GraphNode, b: GraphNode): void {
  const aId = toNodeId(a);
  const bId = toNodeId(b);

  let neighborsA = adjacency.get(aId);
  if (!neighborsA) {
    neighborsA = new Set<string>();
    adjacency.set(aId, neighborsA);
  }

  let neighborsB = adjacency.get(bId);
  if (!neighborsB) {
    neighborsB = new Set<string>();
    adjacency.set(bId, neighborsB);
  }

  neighborsA.add(bId);
  neighborsB.add(aId);
}

// Bidirectional BFS: maintain two frontiers and two parent maps, always expand
// the smaller frontier first, stop when a node appears in both visited sets,
// then reconstruct the full path by walking parents from the meeting node to both sides.
// `excluded` (if given) is seeded into both visited sets up front - since a node already
// counted as "visited" is never re-added to either frontier, this means the search can never
// route through it, without any extra branching in expandOneLayer.
function bidirectionalBfs(
  adjacency: Map<string, Set<string>>,
  start: string,
  target: string,
  excluded: Set<string> = new Set(),
): string[] | null {
  const frontA = new Set<string>([start]);
  const frontB = new Set<string>([target]);

  const visitedA = new Set<string>([start, ...excluded]);
  const visitedB = new Set<string>([target, ...excluded]);

  const parentA = new Map<string, string | null>([[start, null]]);
  const parentB = new Map<string, string | null>([[target, null]]);

  while (frontA.size > 0 && frontB.size > 0) {
    const expandA = frontA.size <= frontB.size;
    const meetingNode = expandA
      ? expandOneLayer(adjacency, frontA, visitedA, parentA, visitedB)
      : expandOneLayer(adjacency, frontB, visitedB, parentB, visitedA);

    if (meetingNode) {
      return reconstructBidirectionalPath(meetingNode, parentA, parentB);
    }
  }

  return null;
}

function expandOneLayer(
  adjacency: Map<string, Set<string>>,
  frontier: Set<string>,
  visitedThisSide: Set<string>,
  parentThisSide: Map<string, string | null>,
  visitedOtherSide: Set<string>,
): string | null {
  const next = new Set<string>();

  for (const node of frontier) {
    const neighbors = adjacency.get(node);
    if (!neighbors) continue;

    for (const neighbor of neighbors) {
      if (visitedThisSide.has(neighbor)) continue;

      visitedThisSide.add(neighbor);
      parentThisSide.set(neighbor, node);

      if (visitedOtherSide.has(neighbor)) {
        return neighbor;
      }

      next.add(neighbor);
    }
  }

  frontier.clear();
  for (const n of next) frontier.add(n);

  return null;
}

function reconstructBidirectionalPath(
  meet: string,
  parentA: Map<string, string | null>,
  parentB: Map<string, string | null>,
): string[] {
  const left: string[] = [];
  let cur: string | null = meet;

  while (cur) {
    left.push(cur);
    cur = parentA.get(cur) ?? null;
  }

  left.reverse();

  const right: string[] = [];
  cur = parentB.get(meet) ?? null;

  while (cur) {
    right.push(cur);
    cur = parentB.get(cur) ?? null;
  }

  return [...left, ...right];
}
