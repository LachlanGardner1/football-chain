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

  async hasEdge(nodeA: { id: number; type: 'PLAYER' | 'CLUB' }, nodeB: { id: number; type: 'PLAYER' | 'CLUB' }): Promise<boolean> {
    if (this.edgeMap) {
      return this.edgeMap[`${nodeA.type}:${nodeA.id}->${nodeB.type}:${nodeB.id}`] ?? this.edgeExists;
    }

    return this.edgeExists;
  }

  async getNodeName(node: { id: number; type: 'PLAYER' | 'CLUB' }) {
    return this.labels[`${node.type}:${node.id}`] ?? null;
  }

  async shortestPathPlayerToPlayer(): Promise<null> {
    return null;
  }
}

test('rejects an empty chain', async () => {
  const service = new ChainValidationService(new StubGraphService(true, {}) as unknown as GraphService);
  const result = await service.validateChain({
    chain: [],
    anchorPlayerIds: [1, 2, 3],
  });

  assert.equal(result.valid, false);
  assert.equal(result.reason, 'Chain too short.');
});

test('accepts starting on any of the anchor players, not just the first one listed', async () => {
  const service = new ChainValidationService(new StubGraphService(true, { 'PLAYER:3': 'Ronaldinho' }) as unknown as GraphService);
  const result = await service.validateChain({
    chain: [{ id: 3, type: 'PLAYER' }],
    anchorPlayerIds: [1, 2, 3],
  });

  assert.equal(result.valid, true);
  assert.equal(result.solved, false);
  assert.equal(result.reason, 'Ready for the next link.');
});

test('rejects a non-player first node', async () => {
  const service = new ChainValidationService(new StubGraphService(true, {}) as unknown as GraphService);
  const result = await service.validateChain({
    chain: [{ id: 2, type: 'CLUB' }],
    anchorPlayerIds: [1, 2, 3],
  });

  assert.equal(result.valid, false);
  assert.equal(result.reason, 'Start with a player node.');
});

test('rejects a start player that is not one of the given anchors', async () => {
  const service = new ChainValidationService(new StubGraphService(true, { 'PLAYER:1': 'Harry Kane' }) as unknown as GraphService);
  const result = await service.validateChain({
    chain: [{ id: 99, type: 'PLAYER' }],
    anchorPlayerIds: [1, 2, 3],
  });

  assert.equal(result.valid, false);
  assert.equal(result.reason, 'Start with one of the given players.');
});

test('rejects a player followed by another player', async () => {
  const service = new ChainValidationService(new StubGraphService(true, { 'PLAYER:1': 'Harry Kane' }) as unknown as GraphService);
  const result = await service.validateChain({
    chain: [
      { id: 1, type: 'PLAYER' },
      { id: 3, type: 'PLAYER' },
    ],
    anchorPlayerIds: [1, 2, 3],
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
    anchorPlayerIds: [1, 2, 3],
  });

  assert.equal(result.valid, false);
  assert.equal(result.reason, 'Real Madrid should be followed by a player.');
});

test('rejects a chain that repeats a player', async () => {
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
      { id: 1, type: 'PLAYER' },
    ],
    anchorPlayerIds: [1, 3],
  });

  assert.equal(result.valid, false);
  assert.equal(result.reason, 'You cannot reuse the same player in a chain.');
});

test('rejects a chain that repeats a club', async () => {
  const graph = new StubGraphService(true, {
    'PLAYER:1': 'Harry Kane',
    'CLUB:2': 'Real Madrid',
    'PLAYER:3': 'Ronaldinho',
    'CLUB:4': 'Tottenham Hotspur',
  }, {
    'PLAYER:1->CLUB:2': true,
    'CLUB:2->PLAYER:3': true,
    'PLAYER:3->CLUB:4': true,
  }) as unknown as GraphService;

  const service = new ChainValidationService(graph);
  const result = await service.validateChain({
    chain: [
      { id: 1, type: 'PLAYER' },
      { id: 2, type: 'CLUB' },
      { id: 3, type: 'PLAYER' },
      { id: 2, type: 'CLUB' },
    ],
    anchorPlayerIds: [1, 3],
  });

  assert.equal(result.valid, false);
  assert.equal(result.reason, 'You cannot reuse the same club in a chain.');
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
    anchorPlayerIds: [1, 3],
  });

  assert.equal(result.valid, false);
  assert.equal(result.reason, "Harry Kane didn't play at Real Madrid.");
});

test('keeps a club-ending chain as in-progress, never solved', async () => {
  const graph = new StubGraphService(true, {
    'PLAYER:1': 'Harry Kane',
    'CLUB:2': 'Real Madrid',
  }) as unknown as GraphService;

  const service = new ChainValidationService(graph);
  const result = await service.validateChain({
    chain: [
      { id: 1, type: 'PLAYER' },
      { id: 2, type: 'CLUB' },
    ],
    anchorPlayerIds: [1, 3],
  });

  assert.equal(result.valid, true);
  assert.equal(result.solved, false);
  assert.equal(result.reason, 'Link looks good. Keep going.');
});

test('keeps a chain in progress when it ends on an anchor but other anchors are still unvisited', async () => {
  const graph = new StubGraphService(true, {
    'PLAYER:1': 'Harry Kane',
    'CLUB:2': 'Tottenham Hotspur',
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
    anchorPlayerIds: [1, 3, 5],
  });

  assert.equal(result.valid, true);
  assert.equal(result.solved, false);
  assert.equal(result.reason, 'Link looks good. Keep going.');
});

test('solves regardless of the order the anchors were visited in', async () => {
  // anchorPlayerIds lists 1, 5, 3 in that order, but the chain below visits
  // them as 1, 3, 5 - order should not matter for solving.
  const graph = new StubGraphService(true, {
    'PLAYER:1': 'Harry Kane',
    'CLUB:2': 'Tottenham Hotspur',
    'PLAYER:3': 'Ronaldinho',
    'CLUB:4': 'Barcelona',
    'PLAYER:5': 'Kaka',
  }, {
    'PLAYER:1->CLUB:2': true,
    'CLUB:2->PLAYER:3': true,
    'PLAYER:3->CLUB:4': true,
    'CLUB:4->PLAYER:5': true,
  }) as unknown as GraphService;

  const service = new ChainValidationService(graph);
  const result = await service.validateChain({
    chain: [
      { id: 1, type: 'PLAYER' },
      { id: 2, type: 'CLUB' },
      { id: 3, type: 'PLAYER' },
      { id: 4, type: 'CLUB' },
      { id: 5, type: 'PLAYER' },
    ],
    anchorPlayerIds: [1, 5, 3],
  });

  assert.equal(result.valid, true);
  assert.equal(result.solved, true);
  assert.equal(result.reason, 'Puzzle completed.');
});

test('solves when the chain detours through a non-anchor player between two anchors', async () => {
  const graph = new StubGraphService(true, {
    'PLAYER:1': 'Harry Kane',
    'CLUB:2': 'Tottenham Hotspur',
    'PLAYER:4': 'Luka Modric',
    'CLUB:5': 'Real Madrid',
    'PLAYER:3': 'Cristiano Ronaldo',
  }, {
    'PLAYER:1->CLUB:2': true,
    'CLUB:2->PLAYER:4': true,
    'PLAYER:4->CLUB:5': true,
    'CLUB:5->PLAYER:3': true,
  }) as unknown as GraphService;

  const service = new ChainValidationService(graph);
  const result = await service.validateChain({
    chain: [
      { id: 1, type: 'PLAYER' },
      { id: 2, type: 'CLUB' },
      { id: 4, type: 'PLAYER' },
      { id: 5, type: 'CLUB' },
      { id: 3, type: 'PLAYER' },
    ],
    anchorPlayerIds: [1, 3],
  });

  assert.equal(result.valid, true);
  assert.equal(result.solved, true);
  assert.equal(result.reason, 'Puzzle completed.');
});

test('does not solve when every anchor has been visited but the chain ends on a non-anchor player', async () => {
  const graph = new StubGraphService(true, {
    'PLAYER:1': 'Harry Kane',
    'CLUB:2': 'Tottenham Hotspur',
    'PLAYER:3': 'Ronaldinho',
    'CLUB:4': 'Barcelona',
    'PLAYER:6': 'Neymar',
  }, {
    'PLAYER:1->CLUB:2': true,
    'CLUB:2->PLAYER:3': true,
    'PLAYER:3->CLUB:4': true,
    'CLUB:4->PLAYER:6': true,
  }) as unknown as GraphService;

  const service = new ChainValidationService(graph);
  const result = await service.validateChain({
    chain: [
      { id: 1, type: 'PLAYER' },
      { id: 2, type: 'CLUB' },
      { id: 3, type: 'PLAYER' },
      { id: 4, type: 'CLUB' },
      { id: 6, type: 'PLAYER' },
    ],
    anchorPlayerIds: [1, 3],
  });

  assert.equal(result.valid, true);
  assert.equal(result.solved, false);
  assert.equal(result.reason, 'Link looks good. Keep going.');
});
