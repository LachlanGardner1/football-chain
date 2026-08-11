import assert from 'node:assert/strict';
import test from 'node:test';

import { findShortestAnchorChain, type GraphEdge } from './solver';

function playerIdsInOrder(path: { id: number; type: 'PLAYER' | 'CLUB' }[]): number[] {
  return path.filter((node) => node.type === 'PLAYER').map((node) => node.id);
}

test('finds the shortest valid chain, not just the first one found', () => {
  const edges: GraphEdge[] = [
    // Longer valid alternate route from player 1 to player 3 via players 4 and 5
    // (length 9), deliberately listed before the short route so a naive
    // first-found search would return this instead.
    { playerId: 1, clubId: 12 },
    { playerId: 4, clubId: 12 },
    { playerId: 4, clubId: 13 },
    { playerId: 2, clubId: 13 },
    { playerId: 2, clubId: 14 },
    { playerId: 5, clubId: 14 },
    { playerId: 5, clubId: 15 },
    { playerId: 3, clubId: 15 },
    // Short direct route: 1 -10- 2 -11- 3 (length 5).
    { playerId: 1, clubId: 10 },
    { playerId: 2, clubId: 10 },
    { playerId: 2, clubId: 11 },
    { playerId: 3, clubId: 11 },
  ];

  const result = findShortestAnchorChain([1, 2, 3], edges);

  assert.ok(result);
  assert.equal(result!.length, 5);
  assert.deepEqual(new Set(playerIdsInOrder(result!)), new Set([1, 2, 3]));
});

test('returns null when the anchors are in disconnected components', () => {
  const edges: GraphEdge[] = [
    { playerId: 1, clubId: 10 },
    { playerId: 2, clubId: 20 },
  ];

  assert.equal(findShortestAnchorChain([1, 2], edges), null);
});

test('returns null rather than a chain that reuses a club across two segments', () => {
  // Players 1, 2, and 3 all only ever share the same single club, so any chain
  // touching all three would have to revisit that club - which isn't allowed.
  const edges: GraphEdge[] = [
    { playerId: 1, clubId: 10 },
    { playerId: 2, clubId: 10 },
    { playerId: 3, clubId: 10 },
  ];

  assert.equal(findShortestAnchorChain([1, 2, 3], edges), null);
});

test('finds a valid chain that detours through a non-anchor player when needed', () => {
  // Player 2 (an anchor) can only reach player 3 (also an anchor) by first going
  // through player 4, who is not an anchor at all.
  const edges: GraphEdge[] = [
    { playerId: 1, clubId: 10 },
    { playerId: 2, clubId: 10 },
    { playerId: 2, clubId: 11 },
    { playerId: 4, clubId: 11 },
    { playerId: 4, clubId: 12 },
    { playerId: 3, clubId: 12 },
  ];

  const result = findShortestAnchorChain([1, 2, 3], edges);

  assert.ok(result);
  assert.deepEqual(playerIdsInOrder(result!), [1, 2, 4, 3]);
});

test('throws for fewer than two anchors', () => {
  assert.throws(() => findShortestAnchorChain([1], []));
});

test('throws for duplicate anchor ids', () => {
  assert.throws(() => findShortestAnchorChain([1, 1, 2], []));
});

// Regression test for a real incident: findShortestAnchorChain was fast on the
// tiny hand-seeded dev graph (every club has 1-3 player edges) but ran for
// several minutes and grew past 1GB of memory - had to be killed - on the real
// imported catalog, where hub clubs (Real Madrid, Man City, ...) have 50-100+
// player edges each. This builds a synthetic graph at a similar scale and shape
// (a handful of high-degree hub clubs, thousands of decoy players, two anchors
// far apart) and asserts the solver still completes quickly.
test('stays fast on a large graph with high-degree hub clubs', () => {
  // Deterministic LCG so the graph (and therefore the test) is reproducible.
  let seed = 42;
  function nextRandom(): number {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  }

  const HUB_COUNT = 8;
  const SPOKES_PER_HUB = 800;

  const HUB_CLUB_ID_BASE = 900_000;
  const CONNECTOR_PLAYER_ID_BASE = 800_000;
  const SPOKE_PLAYER_ID_BASE = 100_000;
  const ANCHOR_A_ID = 999_001;
  const ANCHOR_B_ID = 999_002;

  const edges: GraphEdge[] = [];
  const hubClubId = (hubIndex: number) => HUB_CLUB_ID_BASE + hubIndex;

  // Connector players link consecutive hubs (hub_0 - hub_1 - ... - hub_{n-1}),
  // forming the one guaranteed path all the way across the graph.
  for (let hubIndex = 0; hubIndex < HUB_COUNT - 1; hubIndex += 1) {
    const connectorPlayerId = CONNECTOR_PLAYER_ID_BASE + hubIndex;
    edges.push({ playerId: connectorPlayerId, clubId: hubClubId(hubIndex) });
    edges.push({ playerId: connectorPlayerId, clubId: hubClubId(hubIndex + 1) });
  }

  // Decoy "spoke" players: each belongs to its home hub plus one other random
  // hub, so a blind search following the wrong neighbor lands several hops deep
  // into an unrelated part of the graph before it can backtrack - the exact
  // shape that made the unguided search blow up on the real dataset.
  let nextSpokeId = SPOKE_PLAYER_ID_BASE;
  for (let hubIndex = 0; hubIndex < HUB_COUNT; hubIndex += 1) {
    for (let i = 0; i < SPOKES_PER_HUB; i += 1) {
      const spokePlayerId = nextSpokeId;
      nextSpokeId += 1;

      edges.push({ playerId: spokePlayerId, clubId: hubClubId(hubIndex) });

      let otherHubIndex = Math.floor(nextRandom() * HUB_COUNT);
      if (otherHubIndex === hubIndex) {
        otherHubIndex = (otherHubIndex + 1) % HUB_COUNT;
      }
      edges.push({ playerId: spokePlayerId, clubId: hubClubId(otherHubIndex) });
    }
  }

  // Anchors sit at opposite ends of the hub chain, degree 1, so the only way
  // between them is across every hub in between.
  edges.push({ playerId: ANCHOR_A_ID, clubId: hubClubId(0) });
  edges.push({ playerId: ANCHOR_B_ID, clubId: hubClubId(HUB_COUNT - 1) });

  const startedAt = Date.now();
  const result = findShortestAnchorChain([ANCHOR_A_ID, ANCHOR_B_ID], edges);
  const elapsedMs = Date.now() - startedAt;

  assert.ok(result, 'expected a chain to be found');
  assert.ok(elapsedMs < 2000, `expected the search to finish in under 2s, took ${elapsedMs}ms`);

  const nodeKeys = result!.map((node) => `${node.type}:${node.id}`);
  assert.equal(new Set(nodeKeys).size, nodeKeys.length, 'chain must not repeat any node');

  const players = playerIdsInOrder(result!);
  assert.ok(players.includes(ANCHOR_A_ID) && players.includes(ANCHOR_B_ID), 'chain must include both anchors');
  assert.ok(
    result!.length <= 2 * HUB_COUNT + 1,
    `expected at most the known connector-chain length (${2 * HUB_COUNT + 1} nodes), got ${result!.length}`,
  );
});
