import type { GraphRepository } from "../../domain/repositories";
import type { GraphNode, GraphService } from "./graph-types";
import { fromNodeId, toNodeId } from "./graph-types";

export class PgGraphService implements GraphService {
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

    const datasetVersionId = await this.graphRepository.getActiveDatasetVersionId();
    const edges = await this.graphRepository.loadPlayerClubEdges(datasetVersionId);

    const adjacency = new Map<string, Set<string>>();
    for (const edge of edges) {
      connect(adjacency, { id: edge.playerId, type: "PLAYER" }, { id: edge.clubId, type: "CLUB" });
    }

    const path = bidirectionalBfs(adjacency, start, target);
    return path?.map(fromNodeId) ?? null;
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
function bidirectionalBfs(adjacency: Map<string, Set<string>>, start: string, target: string): string[] | null {
  const frontA = new Set<string>([start]);
  const frontB = new Set<string>([target]);

  const visitedA = new Set<string>([start]);
  const visitedB = new Set<string>([target]);

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
