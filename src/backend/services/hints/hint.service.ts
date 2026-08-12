import type { GraphRepository, HintRepository } from "../../domain/repositories";
import type { ChainNodeInput } from "../../domain/types";
import type { GraphNode, GraphService } from "../graph/graph-types";

export type HintResult =
  | {
      kind: "ANCHOR_CLUB";
      anchorPlayerId: number;
      anchorPlayerName: string;
      clubId: number;
      clubName: string;
      hintsUsed: number;
    }
  | {
      kind: "NEXT_STEP";
      fromNodeId: number;
      fromNodeType: "PLAYER" | "CLUB";
      fromLabel: string;
      nodeId: number;
      nodeType: "PLAYER" | "CLUB";
      label: string;
      hintsUsed: number;
    }
  | { kind: "NONE"; reason: string; hintsUsed: number };

// Two-phase hint sequencing: (1) reveal each still-unvisited anchor's most-time-spent club,
// one per hint, in a stable order - once every remaining anchor has been hinted this way,
// (2) start revealing the actual next link in the chain, one step at a time, via a no-repeat-
// aware shortest path toward the nearest unvisited anchor.
export class HintService {
  constructor(
    private readonly hintRepo: HintRepository,
    private readonly graph: GraphService,
    private readonly graphRepo: GraphRepository,
  ) {}

  // Read-only snapshot of hint state for a (user, puzzle) - used to hydrate the UI on page
  // load (e.g. after a refresh) without spending a new hint.
  async getRevealedState(userId: string, puzzleId: number) {
    const [hintsUsed, revealedAnchorClubHints] = await Promise.all([
      this.hintRepo.getHintsUsed(userId, puzzleId),
      this.hintRepo.getRevealedAnchorClubHints(userId, puzzleId),
    ]);
    return { hintsUsed, revealedAnchorClubHints };
  }

  async getHint(params: {
    userId: string;
    puzzleId: number;
    // Expected in the same stable order the UI already sorts anchors in (alphabetical) -
    // that order is what determines which anchor gets hinted first.
    anchorPlayers: Array<{ id: number; name: string }>;
    chain: ChainNodeInput[];
  }): Promise<HintResult> {
    const { userId, puzzleId, anchorPlayers, chain } = params;

    const visitedPlayerIds = new Set(chain.filter((node) => node.type === "PLAYER").map((node) => node.id));
    const unvisitedAnchors = anchorPlayers.filter((anchor) => !visitedPlayerIds.has(anchor.id));

    if (unvisitedAnchors.length === 0) {
      const hintsUsed = await this.hintRepo.incrementHintsUsed(userId, puzzleId);
      return { kind: "NONE", reason: "All anchors are already visited.", hintsUsed };
    }

    const revealed = await this.hintRepo.getRevealedAnchorClubHints(userId, puzzleId);
    const revealedAnchorIds = new Set(revealed.map((hint) => hint.anchorPlayerId));
    const nextUnhintedAnchor = unvisitedAnchors.find((anchor) => !revealedAnchorIds.has(anchor.id));

    if (nextUnhintedAnchor) {
      const datasetVersionId = await this.graphRepo.getActiveDatasetVersionId();
      const club = await this.hintRepo.getMostTimeAtClub(nextUnhintedAnchor.id, datasetVersionId);

      if (club) {
        // incrementHintsUsed runs first because it's the one that ensures a `users` row
        // exists (a hint can be the very first thing a brand-new anonymous session does) -
        // recordAnchorClubHint has a foreign key to users and would fail otherwise.
        const hintsUsed = await this.hintRepo.incrementHintsUsed(userId, puzzleId);
        await this.hintRepo.recordAnchorClubHint({
          userId,
          puzzleId,
          anchorPlayerId: nextUnhintedAnchor.id,
          clubId: club.clubId,
        });

        return {
          kind: "ANCHOR_CLUB",
          anchorPlayerId: nextUnhintedAnchor.id,
          anchorPlayerName: nextUnhintedAnchor.name,
          clubId: club.clubId,
          clubName: club.clubName,
          hintsUsed,
        };
      }
      // Every real anchor has at least one edge by construction, so this shouldn't happen -
      // fall through to the next-step phase rather than getting stuck.
    }

    return this.getNextStepHint(userId, puzzleId, unvisitedAnchors, chain);
  }

  private async getNextStepHint(
    userId: string,
    puzzleId: number,
    unvisitedAnchors: Array<{ id: number; name: string }>,
    chain: ChainNodeInput[],
  ): Promise<HintResult> {
    const excluded: GraphNode[] = chain.map((node) => ({ id: node.id, type: node.type }));
    const lastNode = chain[chain.length - 1];

    let fromNode: GraphNode | null = lastNode ? { id: lastNode.id, type: lastNode.type } : null;
    let path: GraphNode[] | null = null;

    if (fromNode) {
      // Try every remaining unvisited anchor, keep whichever is nearest.
      for (const anchor of unvisitedAnchors) {
        const candidatePath = await this.graph.shortestPathAvoiding(fromNode, anchor.id, excluded);
        if (candidatePath && (!path || candidatePath.length < path.length)) {
          path = candidatePath;
        }
      }
    } else if (unvisitedAnchors.length >= 2) {
      // No confirmed steps yet, but every anchor's club has already been hinted. Fall back to
      // the closest pair of unvisited anchors and suggest starting from one of them.
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

      if (bestPath && bestFromId !== null) {
        fromNode = { id: bestFromId, type: "PLAYER" };
        path = bestPath;
      }
    }

    const hintsUsed = await this.hintRepo.incrementHintsUsed(userId, puzzleId);

    if (!fromNode || !path || path.length < 2) {
      return { kind: "NONE", reason: "No further hint is available right now.", hintsUsed };
    }

    const nextNode = path[1];
    const [fromLabel, label] = await Promise.all([
      this.graph.getNodeName(fromNode),
      this.graph.getNodeName(nextNode),
    ]);

    return {
      kind: "NEXT_STEP",
      fromNodeId: fromNode.id,
      fromNodeType: fromNode.type,
      fromLabel: fromLabel ?? `${fromNode.type === "PLAYER" ? "Player" : "Club"} ${fromNode.id}`,
      nodeId: nextNode.id,
      nodeType: nextNode.type,
      label: label ?? `${nextNode.type === "PLAYER" ? "Player" : "Club"} ${nextNode.id}`,
      hintsUsed,
    };
  }
}
