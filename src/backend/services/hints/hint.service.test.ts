import assert from 'node:assert/strict';
import test from 'node:test';

import type { GraphRepository, HintRepository, RevealedAnchorClubHint } from '../../domain/repositories';
import type { GraphNode, GraphService } from '../graph/graph-types';
import { HintService } from './hint.service';

class StubHintRepository implements HintRepository {
  public recordedHints: Array<{ anchorPlayerId: number; clubId: number }> = [];
  public hintsUsedCount = 0;

  constructor(
    private revealed: RevealedAnchorClubHint[],
    private clubByPlayer: Record<number, { clubId: number; clubName: string }> = {},
  ) {}

  async getRevealedAnchorClubHints(): Promise<RevealedAnchorClubHint[]> {
    return this.revealed;
  }

  async getMostTimeAtClub(playerId: number): Promise<{ clubId: number; clubName: string } | null> {
    return this.clubByPlayer[playerId] ?? null;
  }

  async recordAnchorClubHint(params: { anchorPlayerId: number; clubId: number }): Promise<void> {
    this.recordedHints.push({ anchorPlayerId: params.anchorPlayerId, clubId: params.clubId });
  }

  async incrementHintsUsed(): Promise<number> {
    this.hintsUsedCount += 1;
    return this.hintsUsedCount;
  }

  async getHintsUsed(): Promise<number> {
    return this.hintsUsedCount;
  }
}

class StubGraphService implements GraphService {
  public shortestPathAvoidingCalls: Array<{ from: GraphNode; targetPlayerId: number; excluded: GraphNode[] }> = [];

  constructor(private pathsByTarget: Record<number, GraphNode[] | null>) {}

  async hasEdge(): Promise<boolean> {
    return true;
  }

  async getNodeName(node: GraphNode): Promise<string> {
    return `${node.type}-${node.id}`;
  }

  async shortestPathPlayerToPlayer(): Promise<null> {
    return null;
  }

  async shortestPathAvoiding(from: GraphNode, targetPlayerId: number, excluded: GraphNode[]): Promise<GraphNode[] | null> {
    this.shortestPathAvoidingCalls.push({ from, targetPlayerId, excluded });
    return this.pathsByTarget[targetPlayerId] ?? null;
  }
}

class StubGraphRepository implements GraphRepository {
  async getActiveDatasetVersionId(): Promise<number> {
    return 1;
  }

  async loadPlayerClubEdges(): Promise<Array<{ playerId: number; clubId: number }>> {
    return [];
  }

  async hasPlayerClubEdge(): Promise<boolean> {
    return true;
  }

  async getPlayerName(): Promise<null> {
    return null;
  }

  async getClubName(): Promise<null> {
    return null;
  }
}

test('reveals the first unvisited anchor\'s most-time club when none have been hinted yet', async () => {
  const hintRepo = new StubHintRepository([], { 1: { clubId: 100, clubName: 'Club A' } });
  const graph = new StubGraphService({});
  const service = new HintService(hintRepo, graph, new StubGraphRepository());

  const result = await service.getHint({
    userId: 'u1',
    puzzleId: 1,
    anchorPlayers: [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }],
    chain: [],
  });

  assert.equal(result.kind, 'ANCHOR_CLUB');
  assert.deepEqual(result, {
    kind: 'ANCHOR_CLUB',
    anchorPlayerId: 1,
    anchorPlayerName: 'Alice',
    clubId: 100,
    clubName: 'Club A',
    hintsUsed: 1,
  });
  assert.deepEqual(hintRepo.recordedHints, [{ anchorPlayerId: 1, clubId: 100 }]);
});

test('skips anchors that already have a revealed hint, moving to the next unvisited one', async () => {
  const hintRepo = new StubHintRepository(
    [{ anchorPlayerId: 1, clubId: 100, clubName: 'Club A' }],
    { 2: { clubId: 200, clubName: 'Club B' } },
  );
  const graph = new StubGraphService({});
  const service = new HintService(hintRepo, graph, new StubGraphRepository());

  const result = await service.getHint({
    userId: 'u1',
    puzzleId: 1,
    anchorPlayers: [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }],
    chain: [],
  });

  assert.equal(result.kind, 'ANCHOR_CLUB');
  assert.equal((result as { anchorPlayerId: number }).anchorPlayerId, 2);
});

test('does not hint an anchor that is already visited in the chain', async () => {
  const hintRepo = new StubHintRepository([], { 2: { clubId: 200, clubName: 'Club B' } });
  const graph = new StubGraphService({});
  const service = new HintService(hintRepo, graph, new StubGraphRepository());

  const result = await service.getHint({
    userId: 'u1',
    puzzleId: 1,
    anchorPlayers: [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }],
    chain: [{ id: 1, type: 'PLAYER' }],
  });

  assert.equal(result.kind, 'ANCHOR_CLUB');
  assert.equal((result as { anchorPlayerId: number }).anchorPlayerId, 2);
});

test('moves to a next-step reveal once every unvisited anchor already has a club hint', async () => {
  const hintRepo = new StubHintRepository([
    { anchorPlayerId: 1, clubId: 100, clubName: 'Club A' },
    { anchorPlayerId: 2, clubId: 200, clubName: 'Club B' },
  ]);
  const path: GraphNode[] = [
    { id: 1, type: 'PLAYER' },
    { id: 999, type: 'CLUB' },
    { id: 2, type: 'PLAYER' },
  ];
  const graph = new StubGraphService({ 2: path });
  const service = new HintService(hintRepo, graph, new StubGraphRepository());

  const result = await service.getHint({
    userId: 'u1',
    puzzleId: 1,
    anchorPlayers: [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }],
    chain: [],
  });

  assert.equal(result.kind, 'NEXT_STEP');
  if (result.kind === 'NEXT_STEP') {
    assert.equal(result.nodeId, 999);
    assert.equal(result.nodeType, 'CLUB');
  }
});

test('excludes every already-used player/club from the next-step path search', async () => {
  const hintRepo = new StubHintRepository([{ anchorPlayerId: 2, clubId: 200, clubName: 'Club B' }]);
  const path: GraphNode[] = [
    { id: 50, type: 'CLUB' },
    { id: 77, type: 'PLAYER' },
    { id: 2, type: 'PLAYER' },
  ];
  const graph = new StubGraphService({ 2: path });
  const service = new HintService(hintRepo, graph, new StubGraphRepository());

  const chain: Array<{ id: number; type: 'PLAYER' | 'CLUB' }> = [
    { id: 1, type: 'PLAYER' },
    { id: 50, type: 'CLUB' },
  ];

  const result = await service.getHint({
    userId: 'u1',
    puzzleId: 1,
    anchorPlayers: [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }],
    chain,
  });

  assert.equal(result.kind, 'NEXT_STEP');
  assert.equal(graph.shortestPathAvoidingCalls.length, 1);
  assert.deepEqual(graph.shortestPathAvoidingCalls[0].excluded, chain);
  assert.deepEqual(graph.shortestPathAvoidingCalls[0].from, { id: 50, type: 'CLUB' });
});

test('returns NONE once every anchor has been visited', async () => {
  const hintRepo = new StubHintRepository([]);
  const graph = new StubGraphService({});
  const service = new HintService(hintRepo, graph, new StubGraphRepository());

  const result = await service.getHint({
    userId: 'u1',
    puzzleId: 1,
    anchorPlayers: [{ id: 1, name: 'Alice' }],
    chain: [{ id: 1, type: 'PLAYER' }],
  });

  assert.equal(result.kind, 'NONE');
});
