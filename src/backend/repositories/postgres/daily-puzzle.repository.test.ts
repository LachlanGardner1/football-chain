import assert from 'node:assert/strict';
import test from 'node:test';

import { mapPublishedPuzzleRowToDto } from './daily-puzzle.repository';

test('maps published puzzle rows with anchor players and optimal length', () => {
  const dto = mapPublishedPuzzleRowToDto({
    puzzle_id: '42',
    puzzle_date: '2026-07-29',
    optimal_length: 4,
    anchor_players: [
      { id: '1', name: 'Alice' },
      { id: 2, name: 'Bob' },
      { id: '3', name: 'Carol' },
    ],
  });

  assert.equal(dto.optimalLength, 4);
  assert.deepEqual(dto.anchorPlayers, [
    { id: 1, name: 'Alice' },
    { id: 2, name: 'Bob' },
    { id: 3, name: 'Carol' },
  ]);
});

test('maps a row with no anchor players to an empty array', () => {
  const dto = mapPublishedPuzzleRowToDto({
    puzzle_id: '42',
    puzzle_date: '2026-07-29',
    optimal_length: null,
    anchor_players: null,
  });

  assert.deepEqual(dto.anchorPlayers, []);
  assert.equal(dto.optimalLength, undefined);
});
