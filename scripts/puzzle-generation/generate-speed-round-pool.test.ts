import assert from 'node:assert/strict';
import test from 'node:test';

import {
  generateSpeedRoundCandidate,
  isAcceptableSpeedRoundChainLength,
  SPEED_ROUND_MAX_CHAIN_LENGTH,
} from './generate-speed-round-pool';
import type { GraphEdge } from './solver';

function sequenceRng(values: number[]): () => number {
  let index = 0;
  return () => {
    const value = values[index % values.length];
    index += 1;
    return value;
  };
}

test('isAcceptableSpeedRoundChainLength accepts a fully-adjacent (no-detour) chain - unlike daily mode, short is desirable here', () => {
  // 3 anchors with no detour = 2*3 - 1 = 5 nodes - daily mode's isAcceptableChainLength
  // rejects this outright; speed round wants it.
  assert.equal(isAcceptableSpeedRoundChainLength(5), true);
});

test('isAcceptableSpeedRoundChainLength accepts exactly the max chain length', () => {
  assert.equal(isAcceptableSpeedRoundChainLength(SPEED_ROUND_MAX_CHAIN_LENGTH), true);
});

test('isAcceptableSpeedRoundChainLength rejects anything past the max chain length', () => {
  assert.equal(isAcceptableSpeedRoundChainLength(SPEED_ROUND_MAX_CHAIN_LENGTH + 1), false);
});

test('generateSpeedRoundCandidate returns null when anchors are in disconnected components and no fallback exists', () => {
  const edges: GraphEdge[] = [
    { playerId: 1, clubId: 10 },
    { playerId: 2, clubId: 20 },
    { playerId: 3, clubId: 30 },
  ];

  const result = generateSpeedRoundCandidate({
    candidatePlayerIds: [1, 2, 3],
    excludedAnchorSetKeys: new Set(),
    edges,
    rng: sequenceRng([0]),
    maxAttempts: 5,
  });

  assert.equal(result, null);
});

test('generateSpeedRoundCandidate accepts a fully-adjacent chain immediately - no fallback/retry needed since short is the goal', () => {
  const edges: GraphEdge[] = [
    { playerId: 1, clubId: 10 },
    { playerId: 2, clubId: 10 },
    { playerId: 2, clubId: 11 },
    { playerId: 3, clubId: 11 },
    { playerId: 1, clubId: 12 },
    { playerId: 3, clubId: 12 },
  ];

  const result = generateSpeedRoundCandidate({
    candidatePlayerIds: [1, 2, 3],
    excludedAnchorSetKeys: new Set(),
    edges,
    rng: sequenceRng([0, 0.3, 0.6]),
    maxAttempts: 10,
  });

  assert.ok(result);
  assert.equal(result!.chainLength, 5);
  assert.deepEqual(new Set(result!.anchorPlayerIds), new Set([1, 2, 3]));
});

test('generateSpeedRoundCandidate skips an anchor set already in excludedAnchorSetKeys, even though it is perfectly solvable', () => {
  // Only one possible 3-player draw exists ({1,2,3}, from a candidate pool of exactly 3), and
  // it's fully solvable - so if exclusion were not actually applied, every attempt would
  // succeed and return it. Excluding that one possible key must make every attempt skip
  // straight past it, exhausting maxAttempts with nothing accepted.
  const edges: GraphEdge[] = [
    { playerId: 1, clubId: 10 },
    { playerId: 2, clubId: 10 },
    { playerId: 2, clubId: 11 },
    { playerId: 3, clubId: 11 },
    { playerId: 1, clubId: 12 },
    { playerId: 3, clubId: 12 },
  ];

  const result = generateSpeedRoundCandidate({
    candidatePlayerIds: [1, 2, 3],
    excludedAnchorSetKeys: new Set(['1,2,3']),
    edges,
    rng: sequenceRng([0, 0.5, 0.99]),
    maxAttempts: 10,
  });

  assert.equal(result, null);
});

test('generateSpeedRoundCandidate returns null when the candidate pool is smaller than the fixed anchor count', () => {
  const result = generateSpeedRoundCandidate({
    candidatePlayerIds: [1, 2],
    excludedAnchorSetKeys: new Set(),
    edges: [],
    rng: sequenceRng([0]),
  });

  assert.equal(result, null);
});
