import assert from 'node:assert/strict';
import test from 'node:test';

import type { GraphRepository, HintRepository, RevealedAnchorClubHint } from '../../domain/repositories';
import type { GraphNode, GraphService } from '../graph/graph-types';
import { HintService } from './hint.service';

class StubHintRepository implements HintRepository {
  public recordedHints: Array<{ anchorPlayerId: number; clubId: number }> = [];
  public nextStepHintsUsedCount = 0;

  constructor(
    private revealed: RevealedAnchorClubHint[] = [],
    private clubsByPlayer: Record<number, Array<{ clubId: number; clubName: string }>> = {},
  ) {}

  async getRevealedAnchorClubHints(): Promise<RevealedAnchorClubHint[]> {
    return this.revealed;
  }

  async getNextUnrevealedClub(
    playerId: number,
    _datasetVersionId: number,
    excludeClubIds: number[],
  ): Promise<{ clubId: number; clubName: string } | null> {
    const clubs = this.clubsByPlayer[playerId] ?? [];
    return clubs.find((club) => !excludeClubIds.includes(club.clubId)) ?? null;
  }

  async recordAnchorClubHint(params: { anchorPlayerId: number; clubId: number }): Promise<void> {
    const club = (this.clubsByPlayer[params.anchorPlayerId] ?? []).find((c) => c.clubId === params.clubId);
    this.recordedHints.push({ anchorPlayerId: params.anchorPlayerId, clubId: params.clubId });
    this.revealed.push({ anchorPlayerId: params.anchorPlayerId, clubId: params.clubId, clubName: club?.clubName ?? 'Club' });
  }

  async incrementNextStepHints(): Promise<number> {
    this.nextStepHintsUsedCount += 1;
    return this.nextStepHintsUsedCount;
  }

  async getNextStepHintsUsed(): Promise<number> {
    return this.nextStepHintsUsedCount;
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

const anchorPlayers = [
  { id: 1, name: 'Alice' },
  { id: 2, name: 'Bob' },
];

// --- revealAnchorClub -------------------------------------------------------------------

test('revealAnchorClub reveals the longest-tenure club first and costs 50', async () => {
  const hintRepo = new StubHintRepository([], { 1: [{ clubId: 100, clubName: 'Club A' }, { clubId: 101, clubName: 'Club B' }] });
  const service = new HintService(hintRepo, new StubGraphService({}), new StubGraphRepository());

  const result = await service.revealAnchorClub({ userId: 'u1', puzzleId: 1, anchorPlayerId: 1, anchorPlayers, chain: [] });

  assert.deepEqual(result, { kind: 'CLUB_REVEALED', anchorPlayerId: 1, clubId: 100, clubName: 'Club A', hintPenalty: 50 });
  assert.deepEqual(hintRepo.recordedHints, [{ anchorPlayerId: 1, clubId: 100 }]);
});

test('revealAnchorClub keeps revealing more clubs for the same anchor on repeat presses', async () => {
  const hintRepo = new StubHintRepository([], { 1: [{ clubId: 100, clubName: 'Club A' }, { clubId: 101, clubName: 'Club B' }] });
  const service = new HintService(hintRepo, new StubGraphService({}), new StubGraphRepository());

  const first = await service.revealAnchorClub({ userId: 'u1', puzzleId: 1, anchorPlayerId: 1, anchorPlayers, chain: [] });
  const second = await service.revealAnchorClub({ userId: 'u1', puzzleId: 1, anchorPlayerId: 1, anchorPlayers, chain: [] });

  assert.equal(first.kind, 'CLUB_REVEALED');
  assert.equal(second.kind, 'CLUB_REVEALED');
  if (second.kind === 'CLUB_REVEALED') {
    assert.equal(second.clubId, 101);
    assert.equal(second.hintPenalty, 100);
  }
});

test('revealAnchorClub reports NO_MORE_CLUBS without charging once every club is revealed', async () => {
  const hintRepo = new StubHintRepository([], { 1: [{ clubId: 100, clubName: 'Club A' }] });
  const service = new HintService(hintRepo, new StubGraphService({}), new StubGraphRepository());

  await service.revealAnchorClub({ userId: 'u1', puzzleId: 1, anchorPlayerId: 1, anchorPlayers, chain: [] });
  const result = await service.revealAnchorClub({ userId: 'u1', puzzleId: 1, anchorPlayerId: 1, anchorPlayers, chain: [] });

  assert.deepEqual(result, { kind: 'NO_MORE_CLUBS', anchorPlayerId: 1, hintPenalty: 50 });
});

test('revealAnchorClub is a free no-op for an anchor that is already visited', async () => {
  const hintRepo = new StubHintRepository([], { 1: [{ clubId: 100, clubName: 'Club A' }] });
  const service = new HintService(hintRepo, new StubGraphService({}), new StubGraphRepository());

  const result = await service.revealAnchorClub({
    userId: 'u1',
    puzzleId: 1,
    anchorPlayerId: 1,
    anchorPlayers,
    chain: [{ id: 1, type: 'PLAYER' }],
  });

  assert.deepEqual(result, { kind: 'NO_MORE_CLUBS', anchorPlayerId: 1, hintPenalty: 0 });
  assert.deepEqual(hintRepo.recordedHints, []);
});

test('revealAnchorClub is a free no-op for a player id that is not an anchor of this puzzle', async () => {
  const hintRepo = new StubHintRepository([], { 999: [{ clubId: 100, clubName: 'Club A' }] });
  const service = new HintService(hintRepo, new StubGraphService({}), new StubGraphRepository());

  const result = await service.revealAnchorClub({ userId: 'u1', puzzleId: 1, anchorPlayerId: 999, anchorPlayers, chain: [] });

  assert.deepEqual(result, { kind: 'NO_MORE_CLUBS', anchorPlayerId: 999, hintPenalty: 0 });
  assert.deepEqual(hintRepo.recordedHints, []);
});

// --- revealNextSteps ---------------------------------------------------------------------

test('revealNextSteps reveals up to 2 nodes ahead and costs 150', async () => {
  const hintRepo = new StubHintRepository();
  const path: GraphNode[] = [
    { id: 1, type: 'PLAYER' },
    { id: 999, type: 'CLUB' },
    { id: 998, type: 'PLAYER' },
    { id: 2, type: 'PLAYER' },
  ];
  const graph = new StubGraphService({ 2: path });
  const service = new HintService(hintRepo, graph, new StubGraphRepository());

  const result = await service.revealNextSteps({
    userId: 'u1',
    puzzleId: 1,
    anchorPlayers,
    chain: [{ id: 1, type: 'PLAYER' }],
  });

  assert.equal(result.kind, 'STEPS_REVEALED');
  if (result.kind === 'STEPS_REVEALED') {
    assert.equal(result.hintPenalty, 150);
    assert.deepEqual(
      result.steps.map((step) => step.id),
      [999, 998],
    );
  }
});

test('revealNextSteps reveals only 1 node when the anchor is a single hop away', async () => {
  const hintRepo = new StubHintRepository();
  const path: GraphNode[] = [
    { id: 1, type: 'PLAYER' },
    { id: 2, type: 'PLAYER' },
  ];
  const graph = new StubGraphService({ 2: path });
  const service = new HintService(hintRepo, graph, new StubGraphRepository());

  const result = await service.revealNextSteps({
    userId: 'u1',
    puzzleId: 1,
    anchorPlayers,
    chain: [{ id: 1, type: 'PLAYER' }],
  });

  assert.equal(result.kind, 'STEPS_REVEALED');
  if (result.kind === 'STEPS_REVEALED') {
    assert.deepEqual(
      result.steps.map((step) => step.id),
      [2],
    );
  }
});

test('revealNextSteps excludes every already-used player/club from the path search', async () => {
  const hintRepo = new StubHintRepository();
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

  await service.revealNextSteps({ userId: 'u1', puzzleId: 1, anchorPlayers, chain });

  assert.equal(graph.shortestPathAvoidingCalls.length, 1);
  assert.deepEqual(graph.shortestPathAvoidingCalls[0].excluded, chain);
  assert.deepEqual(graph.shortestPathAvoidingCalls[0].from, { id: 50, type: 'CLUB' });
});

test('revealNextSteps falls back to the closest anchor pair when the chain is empty', async () => {
  const hintRepo = new StubHintRepository();
  const path: GraphNode[] = [
    { id: 1, type: 'PLAYER' },
    { id: 999, type: 'CLUB' },
    { id: 2, type: 'PLAYER' },
  ];
  const graph = new StubGraphService({ 2: path });
  const service = new HintService(hintRepo, graph, new StubGraphRepository());

  const result = await service.revealNextSteps({ userId: 'u1', puzzleId: 1, anchorPlayers, chain: [] });

  assert.equal(result.kind, 'STEPS_REVEALED');
  if (result.kind === 'STEPS_REVEALED') {
    assert.equal(result.fromNodeId, 1);
  }
});

test('revealNextSteps returns NONE once every anchor has been visited', async () => {
  const hintRepo = new StubHintRepository();
  const service = new HintService(hintRepo, new StubGraphService({}), new StubGraphRepository());

  const result = await service.revealNextSteps({
    userId: 'u1',
    puzzleId: 1,
    anchorPlayers: [{ id: 1, name: 'Alice' }],
    chain: [{ id: 1, type: 'PLAYER' }],
  });

  assert.equal(result.kind, 'NONE');
});
