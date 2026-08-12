import type { GraphRepository, HintRepository, RevealedAnchorClubHint } from "../../domain/repositories";
import type { ChainNodeInput } from "../../domain/types";
import type { GraphNode, GraphService } from "../graph/graph-types";

// Mirrors src/app/scoring.ts's constants of the same name - kept as small independent
// duplicates (see scripts/normalize-name.ts / src/app/puzzle-suggestions.ts for the same
// pattern with foldAccents) since this is backend code and scoring.ts is frontend-only, with
// no other reason to share a module for two numbers.
export const ANCHOR_CLUB_HINT_PENALTY_POINTS = 50;
export const NEXT_STEPS_HINT_PENALTY_POINTS = 150;

export type RevealAnchorClubResult =
  | {
      kind: "CLUB_REVEALED";
      anchorPlayerId: number;
      clubId: number;
      clubName: string;
      hintPenalty: number;
    }
  | { kind: "NO_MORE_CLUBS"; anchorPlayerId: number; hintPenalty: number };

export type RevealNextStepsResult =
  | {
      kind: "STEPS_REVEALED";
      fromNodeId: number;
      fromNodeType: "PLAYER" | "CLUB";
      fromLabel: string;
      steps: Array<{ id: number; type: "PLAYER" | "CLUB"; label: string }>;
      hintPenalty: number;
    }
  | { kind: "NONE"; reason: string; hintPenalty: number };

// Two independent hint actions, each with its own point cost:
// - revealAnchorClub: reveals one club for a *specific* still-unvisited anchor, longest-
//   tenure first. Repeat presses for the same anchor keep revealing more of their clubs until
//   none remain, at which point it's a free no-op (never charges for revealing nothing new).
// - revealNextSteps: reveals up to 2 nodes ahead (a player+club or club+player pair) along a
//   no-repeat-aware shortest path toward the nearest unvisited anchor.
export class HintService {
  constructor(
    private readonly hintRepo: HintRepository,
    private readonly graph: GraphService,
    private readonly graphRepo: GraphRepository,
  ) {}

  // Read-only snapshot of hint state for a (user, puzzle) - used to hydrate the UI on page
  // load (e.g. after a refresh) without spending a new hint.
  async getRevealedState(userId: string, puzzleId: number) {
    const [revealedAnchorClubHints, nextStepHintsUsed] = await Promise.all([
      this.hintRepo.getRevealedAnchorClubHints(userId, puzzleId),
      this.hintRepo.getNextStepHintsUsed(userId, puzzleId),
    ]);

    return {
      revealedAnchorClubHints,
      nextStepHintsUsed,
      hintPenalty: this.computePenaltyFrom(revealedAnchorClubHints, nextStepHintsUsed),
    };
  }

  async revealAnchorClub(params: {
    userId: string;
    puzzleId: number;
    anchorPlayerId: number;
    anchorPlayers: Array<{ id: number; name: string }>;
    chain: ChainNodeInput[];
  }): Promise<RevealAnchorClubResult> {
    const { userId, puzzleId, anchorPlayerId, anchorPlayers, chain } = params;

    const visitedPlayerIds = new Set(chain.filter((node) => node.type === "PLAYER").map((node) => node.id));
    const isRevealableAnchor = anchorPlayers.some((anchor) => anchor.id === anchorPlayerId) && !visitedPlayerIds.has(anchorPlayerId);

    if (!isRevealableAnchor) {
      return { kind: "NO_MORE_CLUBS", anchorPlayerId, hintPenalty: await this.computeTotalHintPenalty(userId, puzzleId) };
    }

    const [datasetVersionId, revealed] = await Promise.all([
      this.graphRepo.getActiveDatasetVersionId(),
      this.hintRepo.getRevealedAnchorClubHints(userId, puzzleId),
    ]);
    const alreadyRevealedClubIds = revealed
      .filter((hint) => hint.anchorPlayerId === anchorPlayerId)
      .map((hint) => hint.clubId);

    const club = await this.hintRepo.getNextUnrevealedClub(anchorPlayerId, datasetVersionId, alreadyRevealedClubIds);

    if (!club) {
      return { kind: "NO_MORE_CLUBS", anchorPlayerId, hintPenalty: await this.computeTotalHintPenalty(userId, puzzleId) };
    }

    await this.hintRepo.recordAnchorClubHint({ userId, puzzleId, anchorPlayerId, clubId: club.clubId });

    return {
      kind: "CLUB_REVEALED",
      anchorPlayerId,
      clubId: club.clubId,
      clubName: club.clubName,
      hintPenalty: await this.computeTotalHintPenalty(userId, puzzleId),
    };
  }

  async revealNextSteps(params: {
    userId: string;
    puzzleId: number;
    anchorPlayers: Array<{ id: number; name: string }>;
    chain: ChainNodeInput[];
  }): Promise<RevealNextStepsResult> {
    const { userId, puzzleId, anchorPlayers, chain } = params;

    const visitedPlayerIds = new Set(chain.filter((node) => node.type === "PLAYER").map((node) => node.id));
    const unvisitedAnchors = anchorPlayers.filter((anchor) => !visitedPlayerIds.has(anchor.id));

    if (unvisitedAnchors.length === 0) {
      return {
        kind: "NONE",
        reason: "All anchors are already visited.",
        hintPenalty: await this.computeTotalHintPenalty(userId, puzzleId),
      };
    }

    const { fromNode, path } = await this.findPathToNearestUnvisitedAnchor(unvisitedAnchors, chain);

    if (!fromNode || !path || path.length < 2) {
      return {
        kind: "NONE",
        reason: "No further hint is available right now.",
        hintPenalty: await this.computeTotalHintPenalty(userId, puzzleId),
      };
    }

    // Up to 2 nodes ahead - a full player+club or club+player pair where the path allows it,
    // fewer only if the target anchor is reached in a single hop.
    const revealedNodes = path.slice(1, 3);
    await this.hintRepo.incrementNextStepHints(userId, puzzleId);

    const [fromLabel, ...stepLabels] = await Promise.all([
      this.graph.getNodeName(fromNode),
      ...revealedNodes.map((node) => this.graph.getNodeName(node)),
    ]);

    return {
      kind: "STEPS_REVEALED",
      fromNodeId: fromNode.id,
      fromNodeType: fromNode.type,
      fromLabel: fromLabel ?? describeNode(fromNode),
      steps: revealedNodes.map((node, index) => ({
        id: node.id,
        type: node.type,
        label: stepLabels[index] ?? describeNode(node),
      })),
      hintPenalty: await this.computeTotalHintPenalty(userId, puzzleId),
    };
  }

  private async findPathToNearestUnvisitedAnchor(
    unvisitedAnchors: Array<{ id: number; name: string }>,
    chain: ChainNodeInput[],
  ): Promise<{ fromNode: GraphNode | null; path: GraphNode[] | null }> {
    const excluded: GraphNode[] = chain.map((node) => ({ id: node.id, type: node.type }));
    const lastNode = chain[chain.length - 1];

    if (lastNode) {
      const fromNode: GraphNode = { id: lastNode.id, type: lastNode.type };
      let path: GraphNode[] | null = null;

      // Try every remaining unvisited anchor, keep whichever is nearest.
      for (const anchor of unvisitedAnchors) {
        const candidatePath = await this.graph.shortestPathAvoiding(fromNode, anchor.id, excluded);
        if (candidatePath && (!path || candidatePath.length < path.length)) {
          path = candidatePath;
        }
      }

      return { fromNode, path };
    }

    if (unvisitedAnchors.length < 2) {
      return { fromNode: null, path: null };
    }

    // No confirmed steps yet. Fall back to the closest pair of unvisited anchors and suggest
    // starting from one of them.
    let bestPath: GraphNode[] | null = null;
    let bestFromId: number | null = null;

    for (let i = 0; i < unvisitedAnchors.length; i += 1) {
      for (let j = i + 1; j < unvisitedAnchors.length; j += 1) {
        const candidatePath = await this.graph.shortestPathAvoiding(
          { id: unvisitedAnchors[i].id, type: "PLAYER" },
          unvisitedAnchors[j].id,
          [],
        );
        if (candidatePath && (!bestPath || candidatePath.length < bestPath.length)) {
          bestPath = candidatePath;
          bestFromId = unvisitedAnchors[i].id;
        }
      }
    }

    return {
      fromNode: bestFromId !== null ? { id: bestFromId, type: "PLAYER" } : null,
      path: bestPath,
    };
  }

  private async computeTotalHintPenalty(userId: string, puzzleId: number): Promise<number> {
    const [revealed, nextStepHintsUsed] = await Promise.all([
      this.hintRepo.getRevealedAnchorClubHints(userId, puzzleId),
      this.hintRepo.getNextStepHintsUsed(userId, puzzleId),
    ]);
    return this.computePenaltyFrom(revealed, nextStepHintsUsed);
  }

  private computePenaltyFrom(revealed: RevealedAnchorClubHint[], nextStepHintsUsed: number): number {
    return revealed.length * ANCHOR_CLUB_HINT_PENALTY_POINTS + nextStepHintsUsed * NEXT_STEPS_HINT_PENALTY_POINTS;
  }
}

function describeNode(node: GraphNode): string {
  return `${node.type === "PLAYER" ? "Player" : "Club"} ${node.id}`;
}
