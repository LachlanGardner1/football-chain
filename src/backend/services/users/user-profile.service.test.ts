import test from 'node:test';
import assert from 'node:assert/strict';
import { UserProfileService } from './user-profile.service';
import type { UserRepository } from '../../domain/repositories';

class StubUserRepository implements UserRepository {
  public lastCall: { userId: string; displayName: string } | null = null;

  async setDisplayName(userId: string, displayName: string): Promise<void> {
    this.lastCall = { userId, displayName };
  }
}

test('trims surrounding whitespace before saving', async () => {
  const repo = new StubUserRepository();
  const service = new UserProfileService(repo);

  const result = await service.setDisplayName('user-1', '  Lachy  ');

  assert.equal(result, 'Lachy');
  assert.deepEqual(repo.lastCall, { userId: 'user-1', displayName: 'Lachy' });
});

test('rejects an empty (or whitespace-only) name', async () => {
  const repo = new StubUserRepository();
  const service = new UserProfileService(repo);

  await assert.rejects(() => service.setDisplayName('user-1', '   '));
  assert.equal(repo.lastCall, null);
});

test('rejects a name over 24 characters', async () => {
  const repo = new StubUserRepository();
  const service = new UserProfileService(repo);

  await assert.rejects(() => service.setDisplayName('user-1', 'a'.repeat(25)));
  assert.equal(repo.lastCall, null);
});

test('accepts a name at exactly the 24 character limit', async () => {
  const repo = new StubUserRepository();
  const service = new UserProfileService(repo);

  const name = 'a'.repeat(24);
  const result = await service.setDisplayName('user-1', name);

  assert.equal(result, name);
});

test('accepts a single-character name', async () => {
  const repo = new StubUserRepository();
  const service = new UserProfileService(repo);

  const result = await service.setDisplayName('user-1', 'X');

  assert.equal(result, 'X');
});
