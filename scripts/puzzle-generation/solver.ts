// Given a set of 3-5 "anchor" players, finds the shortest possible alternating
// PLAYER -> CLUB -> PLAYER chain that starts on one anchor, ends on another, and
// visits every other anchor somewhere in between, in whichever order turns out
// shortest - never reusing a player or club. Returns null if no ordering of the
// anchors can be connected at all (the candidate anchor set is unsolvable).
//
// This exists because the old puzzle-authoring path (a single first-found DFS
// path, with a hand-typed "required players" list never checked against the
// graph at all) neither guaranteed a shortest route nor verified solvability.

export type GraphNode = { id: number; type: "PLAYER" | "CLUB" };
export type GraphEdge = { playerId: number; clubId: number };

function toNodeId(node: GraphNode): string {
  return `${node.type}:${node.id}`;
}

function fromNodeId(nodeId: string): GraphNode {
  const [type, rawId] = nodeId.split(":");
  return { id: Number(rawId), type: type as GraphNode["type"] };
}

function buildAdjacency(edges: GraphEdge[]): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();

  const connect = (a: GraphNode, b: GraphNode) => {
    const aId = toNodeId(a);
    const bId = toNodeId(b);
    if (!adjacency.has(aId)) adjacency.set(aId, new Set());
    if (!adjacency.has(bId)) adjacency.set(bId, new Set());
    adjacency.get(aId)!.add(bId);
    adjacency.get(bId)!.add(aId);
  };

  for (const edge of edges) {
    connect({ id: edge.playerId, type: "PLAYER" }, { id: edge.clubId, type: "CLUB" });
  }

  return adjacency;
}

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];

  const result: T[][] = [];
  for (let i = 0; i < items.length; i += 1) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const perm of permutations(rest)) {
      result.push([items[i], ...perm]);
    }
  }

  return result;
}

// Depth-first, branch-and-bound search for the shortest alternating no-repeat path
// that visits `checkpoints` (player node ids, PLAYER type) in that exact order as a
// subsequence of the path - other players/clubs may appear in between to bridge two
// checkpoints that don't share a club directly. `bestKnownLength` (from earlier
// orderings already tried) prunes any branch that can no longer beat it.
function searchOrdering(
  adjacency: Map<string, Set<string>>,
  checkpoints: string[],
  bestKnownLength: number,
): string[] | null {
  const start = checkpoints[0];
  if (!adjacency.has(start)) return null;

  const visited = new Set<string>([start]);
  const path: string[] = [start];
  let localBestLength = bestKnownLength;
  let localBest: string[] | null = null;

  function backtrack(current: string, nextCheckpointIndex: number): void {
    if (nextCheckpointIndex === checkpoints.length) {
      localBest = [...path];
      localBestLength = path.length;
      return;
    }

    // At least two more nodes (a club, then the next player) are needed to make any
    // further progress, so once we're within one node of the best known length, no
    // completion from here can beat it.
    if (path.length + 1 >= localBestLength) return;

    const neighbors = adjacency.get(current);
    if (!neighbors) return;

    for (const neighbor of neighbors) {
      if (visited.has(neighbor)) continue;

      visited.add(neighbor);
      path.push(neighbor);

      const isCheckpointHit = neighbor === checkpoints[nextCheckpointIndex];
      backtrack(neighbor, isCheckpointHit ? nextCheckpointIndex + 1 : nextCheckpointIndex);

      path.pop();
      visited.delete(neighbor);
    }
  }

  backtrack(start, 1);
  return localBest;
}

export function findShortestAnchorChain(anchorPlayerIds: number[], edges: GraphEdge[]): GraphNode[] | null {
  const uniqueAnchors = Array.from(new Set(anchorPlayerIds));

  if (uniqueAnchors.length !== anchorPlayerIds.length) {
    throw new Error("Anchor player ids must be unique.");
  }

  if (uniqueAnchors.length < 2) {
    throw new Error("At least two anchor players are required.");
  }

  const adjacency = buildAdjacency(edges);
  let best: string[] | null = null;

  for (const ordering of permutations(uniqueAnchors)) {
    const checkpoints = ordering.map((id) => toNodeId({ id, type: "PLAYER" }));
    const result = searchOrdering(adjacency, checkpoints, best?.length ?? Infinity);

    if (result && (!best || result.length < best.length)) {
      best = result;
    }
  }

  return best ? best.map(fromNodeId) : null;
}
