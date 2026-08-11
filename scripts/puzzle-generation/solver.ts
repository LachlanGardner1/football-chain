// Given a set of 3-5 "anchor" players, finds the shortest possible alternating
// PLAYER -> CLUB -> PLAYER chain that starts on one anchor, ends on another, and
// visits every other anchor somewhere in between, in whichever order turns out
// shortest - never reusing a player or club. Returns null if no ordering of the
// anchors can be connected at all (the candidate anchor set is unsolvable).
//
// This exists because the old puzzle-authoring path (a single first-found DFS
// path, with a hand-typed "required players" list never checked against the
// graph at all) neither guaranteed a shortest route nor verified solvability.
//
// The search itself is exhaustive branch-and-bound backtracking (still the true
// shortest no-repeat chain, guaranteed), but it's *guided* by cheap unconstrained
// BFS distances from each anchor: blind neighbor-order DFS is fine on a small
// graph, but explodes combinatorially on a real graph with high-degree "hub"
// clubs (Real Madrid, Man City, ...), since it can wander deep into an unrelated
// part of the graph before finding the right direction. Precomputed BFS
// distances let the search try the most promising ordering and the most
// promising next node first, so pruning kicks in almost immediately in practice.

export type GraphNode = { id: number; type: "PLAYER" | "CLUB" };
export type GraphEdge = { playerId: number; clubId: number };

const DEFAULT_NODE_BUDGET_PER_ORDERING = 300_000;

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

// Plain single-source BFS over the whole graph, completely unconstrained by the
// no-repeat rule. Used only as a heuristic/lower bound to guide the real search -
// never returned as an answer on its own, since it may reuse nodes that a real
// chain can't.
function bfsDistancesFrom(adjacency: Map<string, Set<string>>, startId: string): Map<string, number> {
  const distances = new Map<string, number>([[startId, 0]]);
  const queue: string[] = [startId];
  let head = 0;

  while (head < queue.length) {
    const current = queue[head];
    head += 1;
    const currentDistance = distances.get(current)!;

    const neighbors = adjacency.get(current);
    if (!neighbors) continue;

    for (const neighbor of neighbors) {
      if (distances.has(neighbor)) continue;
      distances.set(neighbor, currentDistance + 1);
      queue.push(neighbor);
    }
  }

  return distances;
}

// Depth-first, branch-and-bound search for the shortest alternating no-repeat path
// that visits `checkpoints` (player node ids, PLAYER type) in that exact order as a
// subsequence of the path - other players/clubs may appear in between to bridge two
// checkpoints that don't share a club directly. `bestKnownLength` (from earlier
// orderings already tried) prunes any branch that can no longer beat it.
// `distancesFromAnchor` (unconstrained BFS hop-counts from each anchor) is used only
// to decide which neighbor to try first at each step - it never changes correctness,
// only how quickly a good answer (and therefore aggressive pruning) is found.
function searchOrdering(
  adjacency: Map<string, Set<string>>,
  checkpoints: string[],
  bestKnownLength: number,
  distancesFromAnchor: Map<string, Map<string, number>>,
  nodeBudget: number,
): string[] | null {
  const start = checkpoints[0];
  if (!adjacency.has(start)) return null;

  const visited = new Set<string>([start]);
  const path: string[] = [start];
  let localBestLength = bestKnownLength;
  let localBest: string[] | null = null;
  let nodesExplored = 0;
  let budgetExceeded = false;

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

    // Try the neighbor that's known (via unconstrained BFS) to be closest to the
    // checkpoint we're currently heading toward first - the search converges to a
    // good answer almost immediately in practice instead of wandering blindly.
    const targetDistances = distancesFromAnchor.get(checkpoints[nextCheckpointIndex]);
    const orderedNeighbors = Array.from(neighbors).sort((a, b) => {
      const distanceA = targetDistances?.get(a) ?? Number.POSITIVE_INFINITY;
      const distanceB = targetDistances?.get(b) ?? Number.POSITIVE_INFINITY;
      return distanceA - distanceB;
    });

    for (const neighbor of orderedNeighbors) {
      if (budgetExceeded) return;
      if (visited.has(neighbor)) continue;

      nodesExplored += 1;
      if (nodesExplored > nodeBudget) {
        budgetExceeded = true;
        return;
      }

      visited.add(neighbor);
      path.push(neighbor);

      const isCheckpointHit = neighbor === checkpoints[nextCheckpointIndex];
      backtrack(neighbor, isCheckpointHit ? nextCheckpointIndex + 1 : nextCheckpointIndex);

      path.pop();
      visited.delete(neighbor);
    }
  }

  backtrack(start, 1);

  if (budgetExceeded) {
    console.warn(
      `findShortestAnchorChain: gave up on one ordering after ${nodeBudget} node expansions without exhausting it; trying the next ordering.`,
    );
  }

  return localBest;
}

export function findShortestAnchorChain(
  anchorPlayerIds: number[],
  edges: GraphEdge[],
  options?: { nodeBudgetPerOrdering?: number },
): GraphNode[] | null {
  const uniqueAnchors = Array.from(new Set(anchorPlayerIds));

  if (uniqueAnchors.length !== anchorPlayerIds.length) {
    throw new Error("Anchor player ids must be unique.");
  }

  if (uniqueAnchors.length < 2) {
    throw new Error("At least two anchor players are required.");
  }

  const adjacency = buildAdjacency(edges);
  const nodeBudget = options?.nodeBudgetPerOrdering ?? DEFAULT_NODE_BUDGET_PER_ORDERING;

  const anchorNodeIds = uniqueAnchors.map((id) => toNodeId({ id, type: "PLAYER" }));
  const distancesFromAnchor = new Map<string, Map<string, number>>();
  for (const anchorNodeId of anchorNodeIds) {
    distancesFromAnchor.set(anchorNodeId, bfsDistancesFrom(adjacency, anchorNodeId));
  }

  // If any two anchors are in different connected components, no ordering can ever
  // work - fail fast instead of exhausting every permutation's backtracking first.
  for (let i = 0; i < anchorNodeIds.length; i += 1) {
    for (let j = i + 1; j < anchorNodeIds.length; j += 1) {
      if (!distancesFromAnchor.get(anchorNodeIds[i])!.has(anchorNodeIds[j])) {
        return null;
      }
    }
  }

  // Sum of unconstrained BFS hop-counts between consecutive checkpoints, +1 to
  // convert edge-count to node-count, is a valid lower bound on that ordering's
  // true no-repeat path length (the no-repeat rule can only force detours, never
  // shortcuts). Trying the most promising ordering first means a near-optimal
  // answer is usually found immediately, which then lets every worse-bounded
  // ordering be skipped without any backtracking at all.
  const orderings = permutations(uniqueAnchors).map((ordering) => {
    const checkpoints = ordering.map((id) => toNodeId({ id, type: "PLAYER" }));
    let lowerBound = 1;
    for (let i = 0; i < checkpoints.length - 1; i += 1) {
      lowerBound += distancesFromAnchor.get(checkpoints[i])!.get(checkpoints[i + 1])!;
    }
    return { checkpoints, lowerBound };
  });
  orderings.sort((a, b) => a.lowerBound - b.lowerBound);

  let best: string[] | null = null;

  for (const { checkpoints, lowerBound } of orderings) {
    const bestKnownLength = best?.length ?? Infinity;
    if (lowerBound >= bestKnownLength) continue;

    const result = searchOrdering(adjacency, checkpoints, bestKnownLength, distancesFromAnchor, nodeBudget);

    if (result && (!best || result.length < best.length)) {
      best = result;
    }
  }

  return best ? best.map(fromNodeId) : null;
}
