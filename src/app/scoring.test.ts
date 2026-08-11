import assert from 'node:assert/strict';
import test from 'node:test';

import { calculatePuzzleScore, resolveProgressScore } from './scoring';

test('awards the expected score for a successful optimal solve', () => {
  const result = calculatePuzzleScore({
    chainLength: 3,
    optimalLength: 3,
    invalidSubmissions: 0,
    solved: true,
  });

  assert.equal(result.score, 1400);
});

test('does not award completion bonuses until the puzzle is solved', () => {
  const result = calculatePuzzleScore({
    chainLength: 3,
    optimalLength: 3,
    invalidSubmissions: 0,
    solved: false,
  });

  assert.equal(result.score, 1000);
  assert.equal(result.completionBonus, 0);
});

test('deducts the expected score for an invalid submission', () => {
  const result = calculatePuzzleScore({
    chainLength: 3,
    optimalLength: 3,
    invalidSubmissions: 1,
    solved: false,
  });

  assert.equal(result.score, 850);
});

test('does not deduct from the score for a longer-than-optimal chain', () => {
  const result = calculatePuzzleScore({
    chainLength: 5,
    optimalLength: 3,
    invalidSubmissions: 0,
    solved: false,
  });

  assert.equal(result.score, 1000);
});

test('withholds the optimal-route bonus when the solve is longer than optimal but still awards the zero-invalid bonus', () => {
  const result = calculatePuzzleScore({
    chainLength: 5,
    optimalLength: 3,
    invalidSubmissions: 0,
    solved: true,
  });

  assert.equal(result.score, 1150);
});

test('keeps the current score aligned with the latest state after a removal', () => {
  const currentScore = calculatePuzzleScore({
    chainLength: 2,
    optimalLength: 3,
    invalidSubmissions: 0,
    solved: false,
  });

  const previousScore = resolveProgressScore(1350, currentScore, true);

  assert.equal(previousScore.score, currentScore.score);
});

test('uses the latest calculated score for the current state', () => {
  const previousScore = calculatePuzzleScore({
    chainLength: 3,
    optimalLength: 3,
    invalidSubmissions: 0,
    solved: true,
  });

  const nextScore = calculatePuzzleScore({
    chainLength: 3,
    optimalLength: 3,
    invalidSubmissions: 1,
    solved: false,
  });

  const resolvedScore = resolveProgressScore(previousScore.score, nextScore, true);

  assert.equal(resolvedScore.score, nextScore.score);
});

test('floors the score at zero', () => {
  const result = calculatePuzzleScore({
    chainLength: 10,
    optimalLength: 3,
    invalidSubmissions: 10,
    solved: false,
  });

  assert.equal(result.score, 0);
});
