import assert from 'node:assert/strict';
import test from 'node:test';

import { createSignedSessionValue, verifySessionCookieValue } from './session.service';

test('verifies a value it signed itself', () => {
  const signed = createSignedSessionValue('11111111-1111-1111-1111-111111111111');

  assert.equal(verifySessionCookieValue(signed), '11111111-1111-1111-1111-111111111111');
});

test('rejects a cookie value with no signature separator', () => {
  assert.equal(verifySessionCookieValue('not-a-signed-value'), null);
});

test('rejects a tampered userId whose signature no longer matches', () => {
  const signed = createSignedSessionValue('11111111-1111-1111-1111-111111111111');
  const [, signature] = signed.split('.');
  const forged = `22222222-2222-2222-2222-222222222222.${signature}`;

  assert.equal(verifySessionCookieValue(forged), null);
});

test('rejects a forged signature appended to a valid userId', () => {
  const forged = '11111111-1111-1111-1111-111111111111.0000000000000000000000000000000000000000000000000000000000000000';

  assert.equal(verifySessionCookieValue(forged), null);
});
