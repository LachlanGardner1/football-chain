import type { GraphBuildInput, GraphNode, GraphService } from "./graph-types";
import { fromNodeId, toNodeId } from "./graph-types";

export class InMemoryGraphService implements GraphService {
  private datasetVersionId: number | null = null;
  private adjacency = new Map<string, Set<string>>();

  rebuild(input: GraphBuildInput): void {
    this.datasetVersionId = input.datasetVersionId;
    this.adjacency.clear();

    for (const edge of input.edges) {
      const player: GraphNode = { id: edge.playerId, type: "PLAYER" };
      const club: GraphNode = { id: edge.clubId, type: "CLUB" };
      this.connect(player, club);
    }
  }

  hasEdge(a: GraphNode, b: GraphNode): boolean {
    const aId = toNodeId(a);
    const bId = toNodeId(b);
    return this.adjacency.get(aId)?.has(bId) ?? false;
  }

  shortestPathPlayerToPlayer(startPlayerId: number, targetPlayerId: number): GraphNode[] | null {
    const start = toNodeId({ id: startPlayerId, type: "PLAYER" });
    const target = toNodeId({ id: targetPlayerId, type: "PLAYER" });

    if (start === target) {
      return [fromNodeId(start)];
    }

    // Bidirectional BFS pseudocode:
    // 1) Maintain two frontiers and two parent maps.
    // 2) Always expand the smaller frontier first.
    // 3) Stop when a node appears in both visited sets.
    // 4) Reconstruct full path by walking parents from meeting node to both sides.

    const frontA = new Set<string>([start]);
    const frontB = new Set<string>([target]);

    const visitedA = new Set<string>([start]);
    const visitedB = new Set<string>([target]);

    const parentA = new Map<string, string | null>([[start, null]]);
    const parentB = new Map<string, string | null>([[target, null]]);

    while (frontA.size > 0 && frontB.size > 0) {
      const expandA = frontA.size <= frontB.size;
      const meetingNode = expandA
        ? this.expandOneLayer(frontA, visitedA, parentA, visitedB)
        : this.expandOneLayer(frontB, visitedB, parentB, visitedA);

      if (meetingNode) {
        const mergedPath = this.reconstructBidirectionalPath(meetingNode, parentA, parentB);
        return mergedPath.map(fromNodeId);
      }
    }

    return null;
  }

  private connect(a: GraphNode, b: GraphNode): void {
    const aId = toNodeId(a);
    const bId = toNodeId(b);

    if (!this.adjacency.has(aId)) this.adjacency.set(aId, new Set<string>());
    if (!this.adjacency.has(bId)) this.adjacency.set(bId, new Set<string>());

    this.adjacency.get(aId)!.add(bId);
    this.adjacency.get(bId)!.add(aId);
  }

  private expandOneLayer(
    frontier: Set<string>,
    visitedThisSide: Set<string>,
    parentThisSide: Map<string, string | null>,
    visitedOtherSide: Set<string>,
  ): string | null {
    const next = new Set<string>();

    for (const node of frontier) {
      const neighbors = this.adjacency.get(node);
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

  private reconstructBidirectionalPath(
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
}
