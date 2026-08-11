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
