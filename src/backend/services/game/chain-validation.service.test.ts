import test from 'node:test';
import assert from 'node:assert/strict';
import { ChainValidationService } from './chain-validation.service';
import type { GraphService } from '../graph/graph-types';

class StubGraphService implements GraphService {
  constructor(
    private readonly edgeExists: boolean,
    private readonly labels: Record<string, string>,
    private readonly edgeMap?: Record<string, boolean>,
  ) {}

  rebuild(): void {}

  hasEdge(nodeA: { id: number; type: 'PLAYER' | 'CLUB' }, nodeB: { id: number; type: 'PLAYER' | 'CLUB' }): boolean {
    if (this.edgeMap) {
      return this.edgeMap[`${nodeA.type}:${nodeA.id}->${nodeB.type}:${nodeB.id}`] ?? this.edgeExists;
    }

    return this.edgeExists;
  }

  getNodeName(node: { id: number; type: 'PLAYER' | 'CLUB' }) {
    return this.labels[`${node.type}:${node.id}`] ?? null;
  }

  shortestPathPlayerToPlayer(): null {
    return null;
  }
}

test('rejects an empty chain', async () => {
  const service = new ChainValidationService(new StubGraphService(true, {}) as unknown as GraphService);
  const result = await service.validateChain({
    chain: [],
    startPlayerId: 1,
    targetPlayerId: 3,
  });

  assert.equal(result.valid, false);
  assert.equal(result.reason, 'Chain too short.');
});

test('accepts the puzzle start player as the first valid step', async () => {
  const service = new ChainValidationService(new StubGraphService(true, { 'PLAYER:1': 'Harry Kane' }) as unknown as GraphService);
  const result = await service.validateChain({
    chain: [{ id: 1, type: 'PLAYER' }],
    startPlayerId: 1,
    targetPlayerId: 3,
  });

  assert.equal(result.valid, true);
  assert.equal(result.solved, false);
  assert.equal(result.reason, 'Ready for the next link.');
});

test('rejects a non-player first node', async () => {
  const service = new ChainValidationService(new StubGraphService(true, {}) as unknown as GraphService);
  const result = await service.validateChain({
    chain: [{ id: 2, type: 'CLUB' }],
    startPlayerId: 1,
    targetPlayerId: 3,
  });

  assert.equal(result.valid, false);
  assert.equal(result.reason, 'Start with a player node.');
});

test('rejects a wrong start player', async () => {
  const service = new ChainValidationService(new StubGraphService(true, { 'PLAYER:1': 'Harry Kane' }) as unknown as GraphService);
  const result = await service.validateChain({
    chain: [{ id: 99, type: 'PLAYER' }],
    startPlayerId: 1,
    targetPlayerId: 3,
  });

  assert.equal(result.valid, false);
  assert.equal(result.reason, 'Start player does not match daily puzzle.');
});

test('rejects a player followed by another player', async () => {
  const service = new ChainValidationService(new StubGraphService(true, { 'PLAYER:1': 'Harry Kane' }) as unknown as GraphService);
  const result = await service.validateChain({
    chain: [
      { id: 1, type: 'PLAYER' },
      { id: 3, type: 'PLAYER' },
    ],
    startPlayerId: 1,
    targetPlayerId: 3,
  });

  assert.equal(result.valid, false);
  assert.equal(result.reason, 'Harry Kane should be followed by a club.');
});

test('rejects a club followed by another club', async () => {
  const service = new ChainValidationService(new StubGraphService(true, { 'CLUB:2': 'Real Madrid' }) as unknown as GraphService);
  const result = await service.validateChain({
    chain: [
      { id: 1, type: 'PLAYER' },
      { id: 2, type: 'CLUB' },
      { id: 99, type: 'CLUB' },
    ],
    startPlayerId: 1,
    targetPlayerId: 3,
  });

  assert.equal(result.valid, false);
  assert.equal(result.reason, 'Real Madrid should be followed by a player.');
});

test('returns a player-club message for a missing edge', async () => {
  const graph = new StubGraphService(false, {
    'PLAYER:1': 'Harry Kane',
    'CLUB:2': 'Real Madrid',
    'PLAYER:3': 'Ronaldinho',
  }) as unknown as GraphService;

  const service = new ChainValidationService(graph);
  const result = await service.validateChain({
    chain: [
      { id: 1, type: 'PLAYER' },
      { id: 2, type: 'CLUB' },
      { id: 3, type: 'PLAYER' },
    ],
    startPlayerId: 1,
    targetPlayerId: 3,
  });

  assert.equal(result.valid, false);
  assert.equal(result.reason, "Harry Kane didn't play at Real Madrid.");
});

test('accepts a valid club step as progress', async () => {
  const graph = new StubGraphService(true, {
    'PLAYER:1': 'Harry Kane',
    'CLUB:2': 'Real Madrid',
    'PLAYER:3': 'Ronaldinho',
  }, {
    'PLAYER:1->CLUB:2': true,
    'CLUB:2->PLAYER:3': false,
  }) as unknown as GraphService;

  const service = new ChainValidationService(graph);
  const result = await service.validateChain({
    chain: [
      { id: 1, type: 'PLAYER' },
      { id: 2, type: 'CLUB' },
    ],
    startPlayerId: 1,
    targetPlayerId: 3,
  });

  assert.equal(result.valid, true);
  assert.equal(result.solved, false);
  assert.equal(result.reason, 'Link looks good. Keep going.');
});

test('marks the chain as solved when the last club links to the target player', async () => {
  const graph = new StubGraphService(true, {
    'PLAYER:1': 'Harry Kane',
    'CLUB:2': 'Real Madrid',
    'PLAYER:3': 'Ronaldinho',
  }, {
    'PLAYER:1->CLUB:2': true,
    'CLUB:2->PLAYER:3': true,
  }) as unknown as GraphService;

  const service = new ChainValidationService(graph);
  const result = await service.validateChain({
    chain: [
      { id: 1, type: 'PLAYER' },
      { id: 2, type: 'CLUB' },
    ],
    startPlayerId: 1,
    targetPlayerId: 3,
  });

  assert.equal(result.valid, true);
  assert.equal(result.solved, true);
  assert.equal(result.reason, 'You reached the goal player.');
});

test('accepts a valid player submission after a club', async () => {
  const graph = new StubGraphService(true, {
    'PLAYER:1': 'Harry Kane',
    'CLUB:2': 'Real Madrid',
    'PLAYER:3': 'Ronaldinho',
  }, {
    'PLAYER:1->CLUB:2': true,
    'CLUB:2->PLAYER:3': true,
  }) as unknown as GraphService;

  const service = new ChainValidationService(graph);
  const result = await service.validateChain({
    chain: [
      { id: 1, type: 'PLAYER' },
      { id: 2, type: 'CLUB' },
      { id: 3, type: 'PLAYER' },
    ],
    startPlayerId: 1,
    targetPlayerId: 3,
  });

  assert.equal(result.valid, true);
  assert.equal(result.solved, true);
  assert.equal(result.reason, 'You reached the goal player.');
});
