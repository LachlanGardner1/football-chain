import assert from 'node:assert/strict';
import test from 'node:test';

import { computeTargetNormalizedNames, findCollisionGroups, type NameRow } from './rebuild-normalized-names';

const identityKey = (canonicalName: string) => canonicalName.toLowerCase();

test('findCollisionGroups returns nothing when every row normalizes uniquely', () => {
  const rows: NameRow[] = [
    { id: 1, canonicalName: 'Alice', createdAt: '2020-01-01T00:00:00Z' },
    { id: 2, canonicalName: 'Bob', createdAt: '2020-01-02T00:00:00Z' },
  ];

  assert.deepEqual(findCollisionGroups(rows, identityKey), []);
});

test('findCollisionGroups picks the most-recently-created row as the winner for a 2-row group', () => {
  const rows: NameRow[] = [
    { id: 1, canonicalName: 'Odegaard', createdAt: '2020-01-01T00:00:00Z' },
    { id: 2, canonicalName: 'ODEGAARD', createdAt: '2021-06-15T00:00:00Z' },
  ];

  const groups = findCollisionGroups(rows, identityKey);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].winnerId, 2);
  assert.deepEqual(groups[0].loserIds, [1]);
});

test('findCollisionGroups generalizes to 3+-row groups, not just pairs', () => {
  const rows: NameRow[] = [
    { id: 1, canonicalName: 'Name', createdAt: '2020-01-01T00:00:00Z' },
    { id: 2, canonicalName: 'NAME', createdAt: '2020-06-01T00:00:00Z' },
    { id: 3, canonicalName: 'name', createdAt: '2021-01-01T00:00:00Z' },
  ];

  const groups = findCollisionGroups(rows, identityKey);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].winnerId, 3);
  assert.deepEqual(groups[0].loserIds.sort(), [1, 2]);
});

test('computeTargetNormalizedNames leaves a non-colliding row with its own recomputed key as a no-op', () => {
  const rows: NameRow[] = [{ id: 1, canonicalName: 'Suárez', createdAt: '2020-01-01T00:00:00Z' }];

  const targets = computeTargetNormalizedNames(rows, (name) => name.toLowerCase());
  assert.equal(targets.get(1), 'suárez');
});

test('computeTargetNormalizedNames assigns the group key to the winner and omits losers', () => {
  const rows: NameRow[] = [
    { id: 1, canonicalName: 'Odegaard', createdAt: '2020-01-01T00:00:00Z' },
    { id: 2, canonicalName: 'ODEGAARD', createdAt: '2021-06-15T00:00:00Z' },
    { id: 3, canonicalName: 'Unrelated', createdAt: '2020-03-01T00:00:00Z' },
  ];

  const targets = computeTargetNormalizedNames(rows, identityKey);
  assert.equal(targets.get(2), 'odegaard');
  assert.equal(targets.has(1), false);
  assert.equal(targets.get(3), 'unrelated');
});
