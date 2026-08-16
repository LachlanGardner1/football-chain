import assert from 'node:assert/strict';
import test from 'node:test';

import { getUsedEntryKeys, getVisibleCatalogEntries } from './puzzle-suggestions';

test('keeps matching clubs visible even when earlier steps already used a different club', () => {
  const clubs = [
    { id: 1, name: 'Real Madrid' },
    { id: 2, name: 'Tottenham Hotspur' },
    { id: 3, name: 'Bayern Munich' },
  ];

  const visible = getVisibleCatalogEntries(clubs, 'real');

  assert.deepStrictEqual(visible.map((entry) => entry.name), ['Real Madrid']);
});

test('marks already-used entries as repeated links', () => {
  const clubs = [
    { id: 1, name: 'Real Madrid' },
    { id: 2, name: 'Tottenham Hotspur' },
  ];

  const visible = getVisibleCatalogEntries(clubs, 'real', [1]);

  assert.deepStrictEqual(visible, [{ id: 1, name: 'Real Madrid', isAlreadyUsed: true }]);
});

test('treats an earlier player step as a different entity than a club suggestion', () => {
  const clubs = [{ id: 1, name: 'Real Madrid' }];

  const visible = getVisibleCatalogEntries(clubs, 'real', ['PLAYER:1'], 'CLUB');

  assert.deepStrictEqual(visible, [{ id: 1, name: 'Real Madrid', isAlreadyUsed: false }]);
});

test('marks a club as used when the same club key was already used', () => {
  const clubs = [{ id: 1, name: 'Real Madrid' }];

  const visible = getVisibleCatalogEntries(clubs, 'real', ['CLUB:1'], 'CLUB');

  assert.deepStrictEqual(visible, [{ id: 1, name: 'Real Madrid', isAlreadyUsed: true }]);
});

test('returns no entries for an empty query', () => {
  const clubs = [{ id: 1, name: 'Real Madrid' }];

  assert.deepStrictEqual(getVisibleCatalogEntries(clubs, '   '), []);
});

test('folds letters with no Unicode NFD decomposition (o slash, d stroke, l stroke, ae, oe, sharp s)', () => {
  const players = [
    { id: 1, name: 'Martin Ødegaard' },
    { id: 2, name: 'Đorđe Petrović' },
    { id: 3, name: 'Łukasz Testperson' },
    { id: 4, name: 'Æsæ Testperson' },
    { id: 5, name: 'Œdipus Testperson' },
    { id: 6, name: 'Straße Testperson' },
  ];

  assert.deepStrictEqual(getVisibleCatalogEntries(players, 'odegaard').map((entry) => entry.id), [1]);
  assert.deepStrictEqual(getVisibleCatalogEntries(players, 'dorde').map((entry) => entry.id), [2]);
  assert.deepStrictEqual(getVisibleCatalogEntries(players, 'lukasz').map((entry) => entry.id), [3]);
  assert.deepStrictEqual(getVisibleCatalogEntries(players, 'aesae').map((entry) => entry.id), [4]);
  assert.deepStrictEqual(getVisibleCatalogEntries(players, 'oedipus').map((entry) => entry.id), [5]);
  assert.deepStrictEqual(getVisibleCatalogEntries(players, 'strasse').map((entry) => entry.id), [6]);
});

test('getUsedEntryKeys only counts steps marked valid', () => {
  const steps = [
    { id: 1, type: 'CLUB' as const },
    { id: 2, type: 'PLAYER' as const },
  ];

  const keys = getUsedEntryKeys(steps, { 0: 'valid', 1: 'invalid' });

  assert.deepStrictEqual([...keys], ['CLUB:1']);
});

test('getUsedEntryKeys excludes the given index and merges in extra keys', () => {
  const steps = [
    { id: 1, type: 'CLUB' as const },
    { id: 2, type: 'PLAYER' as const },
  ];

  const keys = getUsedEntryKeys(steps, { 0: 'valid', 1: 'valid' }, {
    excludeIndex: 1,
    includeKeys: ['PLAYER:99'],
  });

  assert.deepStrictEqual([...keys].sort(), ['CLUB:1', 'PLAYER:99']);
});
