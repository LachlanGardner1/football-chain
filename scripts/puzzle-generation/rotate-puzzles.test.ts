import assert from 'node:assert/strict';
import test from 'node:test';

import {
  chooseAnchorCount,
  dateDaysBefore,
  datesForTopUp,
  generateCandidateChain,
  isAcceptableChainLength,
  pickRandomAnchors,
  selectAnchorCandidatePool,
} from './rotate-puzzles';
import type { GraphEdge } from './solver';

test('datesForTopUp returns the N days immediately after today, in order', () => {
  assert.deepEqual(datesForTopUp('2026-08-11', 3), ['2026-08-12', '2026-08-13', '2026-08-14']);
});

test('datesForTopUp rolls over month/year boundaries', () => {
  assert.deepEqual(datesForTopUp('2026-12-30', 3), ['2026-12-31', '2027-01-01', '2027-01-02']);
});

test('dateDaysBefore rolls backward over a month boundary', () => {
  assert.equal(dateDaysBefore('2026-08-05', 10), '2026-07-26');
});

test('isAcceptableChainLength rejects a fully-adjacent (no detour) chain', () => {
  // 3 anchors with no detour = 2*3 - 1 = 5 nodes.
  assert.equal(isAcceptableChainLength(3, 5), false);
});

test('isAcceptableChainLength accepts a chain with at least one non-anchor hop', () => {
  assert.equal(isAcceptableChainLength(3, 7), true);
});

test('isAcceptableChainLength rejects an unreasonably long chain', () => {
  assert.equal(isAcceptableChainLength(3, 15), false);
});

test('pickRandomAnchors samples without replacement', () => {
  const rng = sequenceRng([0, 0.5, 0.99]);
  const picked = pickRandomAnchors([1, 2, 3, 4, 5], 3, rng);
  assert.equal(picked.length, 3);
  assert.equal(new Set(picked).size, 3);
});

test('pickRandomAnchors throws when the pool is smaller than the requested count', () => {
  assert.throws(() => pickRandomAnchors([1, 2], 3));
});

test('chooseAnchorCount only ever returns 3, 4, or 5', () => {
  for (const rngValue of [0, 0.34, 0.67, 0.999]) {
    const count = chooseAnchorCount(() => rngValue);
    assert.ok([3, 4, 5].includes(count));
  }
});

test('generateCandidateChain returns null when anchors are in disconnected components and no fallback exists', () => {
  const edges: GraphEdge[] = [
    { playerId: 1, clubId: 10 },
    { playerId: 2, clubId: 20 },
    { playerId: 3, clubId: 30 },
  ];

  const result = generateCandidateChain({
    anchorCount: 3,
    candidatePlayerIds: [1, 2, 3],
    excludedPlayerIds: new Set(),
    edges,
    rng: sequenceRng([0]),
    maxAttempts: 5,
  });

  assert.equal(result, null);
});

test('generateCandidateChain falls back to a "just solvable" chain when nothing in-band is found', () => {
  // Players 1, 2, 3 form a triangle of directly-shared clubs (each pair shares a distinct
  // club), so the only candidate pool is exactly these three anchors - every attempt finds
  // the same fully-adjacent, no-detour chain (5 nodes), which is always below the in-band
  // minimum of 2*3-1+2=9. This exercises the fallback path rather than the in-band accept
  // path.
  const edges: GraphEdge[] = [
    { playerId: 1, clubId: 10 },
    { playerId: 2, clubId: 10 },
    { playerId: 2, clubId: 11 },
    { playerId: 3, clubId: 11 },
    { playerId: 1, clubId: 12 },
    { playerId: 3, clubId: 12 },
  ];

  const result = generateCandidateChain({
    anchorCount: 3,
    candidatePlayerIds: [1, 2, 3],
    excludedPlayerIds: new Set(),
    edges,
    rng: sequenceRng([0, 0.3, 0.6]),
    maxAttempts: 10,
  });

  assert.ok(result);
  assert.equal(result!.chain.length, 5);
  assert.deepEqual(new Set(result!.anchorPlayerIds), new Set([1, 2, 3]));
});

test('generateCandidateChain falls back to the full candidate pool when exclusions leave too few players', () => {
  const edges: GraphEdge[] = [
    { playerId: 1, clubId: 10 },
    { playerId: 2, clubId: 10 },
    { playerId: 2, clubId: 11 },
    { playerId: 3, clubId: 11 },
  ];

  const result = generateCandidateChain({
    anchorCount: 3,
    candidatePlayerIds: [1, 2, 3],
    excludedPlayerIds: new Set([1, 2, 3]),
    edges,
    rng: sequenceRng([0, 0.5, 0.99]),
    maxAttempts: 10,
  });

  assert.ok(result);
  assert.deepEqual(new Set(result!.anchorPlayerIds), new Set([1, 2, 3]));
});

test('selectAnchorCandidatePool uses the famous-restricted pool when it can cover the largest anchor count', () => {
  const famous = [1, 2, 3, 4, 5, 6];
  const full = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.deepEqual(selectAnchorCandidatePool(famous, full), famous);
});

test('selectAnchorCandidatePool falls back to the full pool when the famous pool is too small', () => {
  const famous = [1, 2, 3];
  const full = [1, 2, 3, 4, 5, 6, 7, 8];
  assert.deepEqual(selectAnchorCandidatePool(famous, full), full);
});

// Deterministic stand-in for Math.random: cycles through a fixed sequence of [0, 1) values.
function sequenceRng(values: number[]): () => number {
  let index = 0;
  return () => {
    const value = values[index % values.length];
    index += 1;
    return value;
  };
}
