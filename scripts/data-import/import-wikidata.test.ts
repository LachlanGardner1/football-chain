import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCandidateAttributesQuery,
  buildCandidateQidsQuery,
  buildEdgesQuery,
  extractIsoDate,
  extractYear,
  hasValidYearRange,
  qidFromUri,
  resolveClubMatch,
  resolvePlayerMatch,
  type ExistingClubRow,
  type ExistingPlayerRow,
} from './import-wikidata';

test('extractYear parses the first 4 chars of an ISO dateTime literal', () => {
  assert.equal(extractYear('1998-06-01T00:00:00Z'), 1998);
});

test('extractYear returns null for undefined/empty input', () => {
  assert.equal(extractYear(undefined), null);
  assert.equal(extractYear(null), null);
  assert.equal(extractYear(''), null);
});

test('qidFromUri strips the Wikidata entity URI prefix', () => {
  assert.equal(qidFromUri('http://www.wikidata.org/entity/Q152462'), 'Q152462');
});

test('extractIsoDate accepts a well-formed dateTime literal', () => {
  assert.equal(extractIsoDate('1998-06-01T00:00:00Z'), '1998-06-01');
});

test('extractIsoDate rejects a malformed value that is not actually a date (real Wikidata data-quality bug hit live)', () => {
  assert.equal(extractIsoDate('http://www.wikidata.org/entity/Q12345'), null);
});

test('extractIsoDate returns null for undefined/empty input', () => {
  assert.equal(extractIsoDate(undefined), null);
  assert.equal(extractIsoDate(null), null);
  assert.equal(extractIsoDate(''), null);
});

test('resolvePlayerMatch: ID match wins even when a name match exists for a different row', () => {
  const byId: ExistingPlayerRow = { id: 1, normalizedName: 'other name', sourceEntityId: '3187', birthYear: 1969 };
  const byName: ExistingPlayerRow = { id: 2, normalizedName: 'dennis bergkamp', sourceEntityId: '9999', birthYear: 1969 };
  const existingByTmId = new Map([['3187', byId]]);
  const existingByNormalizedName = new Map([['dennis bergkamp', byName]]);

  const match = resolvePlayerMatch({ tmId: '3187', normalizedName: 'dennis bergkamp', birthYear: 1969 }, existingByTmId, existingByNormalizedName);

  assert.deepEqual(match, { kind: 'id', existing: byId });
});

test('resolvePlayerMatch: pure name match succeeds when both birth years are unknown', () => {
  const existing: ExistingPlayerRow = { id: 1, normalizedName: 'sol campbell', sourceEntityId: null, birthYear: null };
  const existingByTmId = new Map<string, ExistingPlayerRow>();
  const existingByNormalizedName = new Map([['sol campbell', existing]]);

  const match = resolvePlayerMatch({ tmId: null, normalizedName: 'sol campbell', birthYear: null }, existingByTmId, existingByNormalizedName);

  assert.deepEqual(match, { kind: 'name', existing });
});

test('resolvePlayerMatch: name match succeeds within the birth-year threshold (inclusive at exactly 2)', () => {
  const existing: ExistingPlayerRow = { id: 1, normalizedName: 'john smith', sourceEntityId: null, birthYear: 1990 };
  const existingByTmId = new Map<string, ExistingPlayerRow>();
  const existingByNormalizedName = new Map([['john smith', existing]]);

  const match = resolvePlayerMatch({ tmId: null, normalizedName: 'john smith', birthYear: 1992 }, existingByTmId, existingByNormalizedName);

  assert.deepEqual(match, { kind: 'name', existing });
});

test('resolvePlayerMatch: returns ambiguous when birth years differ beyond the threshold', () => {
  const existing: ExistingPlayerRow = { id: 1, normalizedName: 'john smith', sourceEntityId: null, birthYear: 1974 };
  const existingByTmId = new Map<string, ExistingPlayerRow>();
  const existingByNormalizedName = new Map([['john smith', existing]]);

  const match = resolvePlayerMatch({ tmId: null, normalizedName: 'john smith', birthYear: 1990 }, existingByTmId, existingByNormalizedName);

  assert.deepEqual(match, { kind: 'ambiguous' });
});

test('resolvePlayerMatch: ambiguous at exactly one year past the threshold (3 years apart)', () => {
  const existing: ExistingPlayerRow = { id: 1, normalizedName: 'john smith', sourceEntityId: null, birthYear: 1990 };
  const existingByTmId = new Map<string, ExistingPlayerRow>();
  const existingByNormalizedName = new Map([['john smith', existing]]);

  const match = resolvePlayerMatch({ tmId: null, normalizedName: 'john smith', birthYear: 1993 }, existingByTmId, existingByNormalizedName);

  assert.deepEqual(match, { kind: 'ambiguous' });
});

test('resolvePlayerMatch: one side missing a birth year falls through to accepting the name match', () => {
  const existing: ExistingPlayerRow = { id: 1, normalizedName: 'john smith', sourceEntityId: null, birthYear: null };
  const existingByTmId = new Map<string, ExistingPlayerRow>();
  const existingByNormalizedName = new Map([['john smith', existing]]);

  const match = resolvePlayerMatch({ tmId: null, normalizedName: 'john smith', birthYear: 1990 }, existingByTmId, existingByNormalizedName);

  assert.deepEqual(match, { kind: 'name', existing });
});

test('resolvePlayerMatch: no match at all returns none', () => {
  const existingByTmId = new Map<string, ExistingPlayerRow>();
  const existingByNormalizedName = new Map<string, ExistingPlayerRow>();

  const match = resolvePlayerMatch({ tmId: '123', normalizedName: 'nobody', birthYear: 1990 }, existingByTmId, existingByNormalizedName);

  assert.deepEqual(match, { kind: 'none' });
});

test('resolveClubMatch: id match wins over a conflicting name match', () => {
  const byId: ExistingClubRow = { id: 1, normalizedName: 'other club', sourceEntityId: '11' };
  const byName: ExistingClubRow = { id: 2, normalizedName: 'arsenal f.c.', sourceEntityId: '999' };
  const existingByTmId = new Map([['11', byId]]);
  const existingByNormalizedName = new Map([['arsenal f.c.', byName]]);

  const match = resolveClubMatch({ tmId: '11', normalizedName: 'arsenal f.c.' }, existingByTmId, existingByNormalizedName);

  assert.deepEqual(match, { kind: 'id', existing: byId });
});

test('resolveClubMatch: falls back to name match when no id match', () => {
  const existing: ExistingClubRow = { id: 1, normalizedName: 'arsenal fc', sourceEntityId: '11' };
  const existingByTmId = new Map<string, ExistingClubRow>();
  const existingByNormalizedName = new Map([['arsenal fc', existing]]);

  const match = resolveClubMatch({ tmId: null, normalizedName: 'arsenal fc' }, existingByTmId, existingByNormalizedName);

  assert.deepEqual(match, { kind: 'name', existing });
});

test('resolveClubMatch: no match at all returns none', () => {
  const existingByTmId = new Map<string, ExistingClubRow>();
  const existingByNormalizedName = new Map<string, ExistingClubRow>();

  const match = resolveClubMatch({ tmId: null, normalizedName: 'nobody fc' }, existingByTmId, existingByNormalizedName);

  assert.deepEqual(match, { kind: 'none' });
});

test('hasValidYearRange accepts a normal ordered range', () => {
  assert.equal(hasValidYearRange(2001, 2006), true);
});

test('hasValidYearRange accepts a range with a missing (open-ended) end year', () => {
  assert.equal(hasValidYearRange(2021, null), true);
});

test('hasValidYearRange accepts equal start and end years', () => {
  assert.equal(hasValidYearRange(2010, 2010), true);
});

test('hasValidYearRange rejects a reversed range (real Wikidata data-quality bug hit live)', () => {
  assert.equal(hasValidYearRange(1965, 1958), false);
});

test('buildCandidateQidsQuery includes the footballer/national-team triples with no aggregation or ordering', () => {
  const query = buildCandidateQidsQuery();

  assert.match(query, /wdt:P106 wd:Q937857/);
  assert.match(query, /VALUES \?natClass \{ wd:Q6979593 wd:Q135408445 \}/);
  assert.doesNotMatch(query, /ORDER BY/);
  assert.doesNotMatch(query, /GROUP BY/);
  assert.doesNotMatch(query, /LIMIT/);
});

test('buildCandidateAttributesQuery builds the VALUES clause from the given QIDs', () => {
  const query = buildCandidateAttributesQuery(['Q1', 'Q2']);

  assert.match(query, /VALUES \?player \{ wd:Q1 wd:Q2 \}/);
  assert.match(query, /wdt:P2446 \?tmId/);
});

test('buildEdgesQuery builds the VALUES clause from the given QIDs and filters to real clubs', () => {
  const query = buildEdgesQuery(['Q1', 'Q2']);

  assert.match(query, /VALUES \?player \{ wd:Q1 wd:Q2 \}/);
  assert.match(query, /wdt:P31 wd:Q476028/);
});
