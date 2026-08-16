import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeName } from './normalize-name';

test('strips NFD-decomposable accents', () => {
  assert.equal(normalizeName('Suárez'), 'suarez');
  assert.equal(normalizeName('José'), 'jose');
});

test('folds letters with no Unicode NFD decomposition', () => {
  assert.equal(normalizeName('Ødegaard'), 'odegaard');
  assert.equal(normalizeName('Đorđe'), 'dorde');
  assert.equal(normalizeName('Łukasz'), 'lukasz');
  assert.equal(normalizeName('Æsæ'), 'aesae');
  assert.equal(normalizeName('Œdipus'), 'oedipus');
  assert.equal(normalizeName('Straße'), 'strasse');
});

test('trims and lowercases', () => {
  assert.equal(normalizeName('  Lionel Messi  '), 'lionel messi');
});
