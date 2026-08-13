import test from 'node:test';
import assert from 'node:assert/strict';
import { SpeedRoundChainValidator } from './speed-round-validation.service';
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

  async shortestPathAvoiding(): Promise<null> {
    return null;
  }
}

test('rejects an empty chain', async () => {
  const service = new SpeedRoundChainValidator(new StubGraphService(true, {}) as unknown as GraphService);
  const result = await service.validateChain({ chain: [], anchorPlayerIds: [1, 2, 3] });

  assert.equal(result.valid, false);
  assert.equal(result.reason, 'Chain too short.');
});

test('rejects a non-player first node', async () => {
  const service = new SpeedRoundChainValidator(new StubGraphService(true, {}) as unknown as GraphService);
  const result = await service.validateChain({ chain: [{ id: 2, type: 'CLUB' }], anchorPlayerIds: [1, 2, 3] });

  assert.equal(result.valid, false);
  assert.equal(result.reason, 'Start with a player.');
});

test('accepts starting on a player who is NOT one of the given anchors - unlike daily mode, any player may start the chain', async () => {
  const service = new SpeedRoundChainValidator(new StubGraphService(true, { 'PLAYER:99': 'Some Midfielder' }) as unknown as GraphService);
  const result = await service.validateChain({ chain: [{ id: 99, type: 'PLAYER' }], anchorPlayerIds: [1, 2, 3] });

  assert.equal(result.valid, true);
  assert.equal(result.solved, false);
  assert.equal(result.reason, 'Ready for the next link.');
});

test('rejects a player followed by another player', async () => {
  const service = new SpeedRoundChainValidator(new StubGraphService(true, { 'PLAYER:1': 'Harry Kane' }) as unknown as GraphService);
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
  const service = new SpeedRoundChainValidator(new StubGraphService(true, { 'CLUB:2': 'Real Madrid' }) as unknown as GraphService);
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

test('allows repeating the same player - unlike daily mode, no-repeat is not enforced', async () => {
  const graph = new StubGraphService(true, {
    'PLAYER:1': 'Harry Kane',
    'CLUB:2': 'Real Madrid',
  }, {
    'PLAYER:1->CLUB:2': true,
    'CLUB:2->PLAYER:1': true,
  }) as unknown as GraphService;

  const service = new SpeedRoundChainValidator(graph);
  const result = await service.validateChain({
    chain: [
      { id: 1, type: 'PLAYER' },
      { id: 2, type: 'CLUB' },
      { id: 1, type: 'PLAYER' },
    ],
    anchorPlayerIds: [1],
  });

  assert.equal(result.valid, true);
});

test('allows repeating the same club - unlike daily mode, no-repeat is not enforced', async () => {
  const graph = new StubGraphService(true, {
    'PLAYER:1': 'Harry Kane',
    'CLUB:2': 'Real Madrid',
    'PLAYER:3': 'Ronaldinho',
  }, {
    'PLAYER:1->CLUB:2': true,
    'CLUB:2->PLAYER:3': true,
    'PLAYER:3->CLUB:2': true,
  }) as unknown as GraphService;

  const service = new SpeedRoundChainValidator(graph);
  const result = await service.validateChain({
    chain: [
      { id: 1, type: 'PLAYER' },
      { id: 2, type: 'CLUB' },
      { id: 3, type: 'PLAYER' },
      { id: 2, type: 'CLUB' },
    ],
    anchorPlayerIds: [1, 3],
  });

  assert.equal(result.valid, true);
});

test('returns a player-club message for a missing edge', async () => {
  const graph = new StubGraphService(false, {
    'PLAYER:1': 'Harry Kane',
    'CLUB:2': 'Real Madrid',
  }) as unknown as GraphService;

  const service = new SpeedRoundChainValidator(graph);
  const result = await service.validateChain({
    chain: [
      { id: 1, type: 'PLAYER' },
      { id: 2, type: 'CLUB' },
    ],
    anchorPlayerIds: [1],
  });

  assert.equal(result.valid, false);
  assert.equal(result.reason, "Harry Kane didn't play at Real Madrid.");
});

test('solves regardless of the order the anchors were visited in, starting from a non-anchor', async () => {
  const graph = new StubGraphService(true, {
    'PLAYER:9': 'Some Connector',
    'CLUB:2': 'Tottenham Hotspur',
    'PLAYER:1': 'Harry Kane',
    'CLUB:4': 'Barcelona',
    'PLAYER:5': 'Kaka',
  }, {
    'PLAYER:9->CLUB:2': true,
    'CLUB:2->PLAYER:1': true,
    'PLAYER:1->CLUB:4': true,
    'CLUB:4->PLAYER:5': true,
  }) as unknown as GraphService;

  const service = new SpeedRoundChainValidator(graph);
  const result = await service.validateChain({
    chain: [
      { id: 9, type: 'PLAYER' },
      { id: 2, type: 'CLUB' },
      { id: 1, type: 'PLAYER' },
      { id: 4, type: 'CLUB' },
      { id: 5, type: 'PLAYER' },
    ],
    anchorPlayerIds: [5, 1],
  });

  assert.equal(result.valid, true);
  assert.equal(result.solved, true);
});

test('solves the instant a club-ending chain has already visited every anchor - unlike daily mode, ending on an anchor is not required', async () => {
  const graph = new StubGraphService(true, {
    'PLAYER:1': 'Harry Kane',
    'CLUB:2': 'Tottenham Hotspur',
    'PLAYER:3': 'Ronaldinho',
    'CLUB:4': 'Barcelona',
  }, {
    'PLAYER:1->CLUB:2': true,
    'CLUB:2->PLAYER:3': true,
    'PLAYER:3->CLUB:4': true,
  }) as unknown as GraphService;

  const service = new SpeedRoundChainValidator(graph);
  const result = await service.validateChain({
    chain: [
      { id: 1, type: 'PLAYER' },
      { id: 2, type: 'CLUB' },
      { id: 3, type: 'PLAYER' },
      { id: 4, type: 'CLUB' },
    ],
    anchorPlayerIds: [1, 3],
  });

  assert.equal(result.valid, true);
  assert.equal(result.solved, true);
});

test('does not solve while an anchor is still unvisited', async () => {
  const graph = new StubGraphService(true, {
    'PLAYER:1': 'Harry Kane',
    'CLUB:2': 'Tottenham Hotspur',
    'PLAYER:3': 'Ronaldinho',
  }, {
    'PLAYER:1->CLUB:2': true,
    'CLUB:2->PLAYER:3': true,
  }) as unknown as GraphService;

  const service = new SpeedRoundChainValidator(graph);
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
});
