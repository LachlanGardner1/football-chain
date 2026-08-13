import type { ChainNodeInput, ValidationResult } from "../../domain/types";
import type { ChainValidator } from "../../domain/repositories";
import type { GraphService } from "../graph/graph-types";

// Speed round's own chain-validity rules - a separate class from ChainValidationService
// (daily mode) rather than a parameterized variant of it, because exactly two structural
// rules differ (daily mode requires the chain to start AND end on one of the given anchors;
// this mode allows repeats and lets anchors appear anywhere, in any order), and dropping them
// changes enough of the control flow that sharing one class would need more branching than
// just having two small ones. The alternation and graph-edge checks below are otherwise the
// same idea as ChainValidationService's.
export class SpeedRoundChainValidator implements ChainValidator {
  constructor(private readonly graph: GraphService) {}

  async validateChain(params: {
    chain: ChainNodeInput[];
    anchorPlayerIds: number[];
  }): Promise<ValidationResult> {
    const { chain, anchorPlayerIds } = params;

    if (chain.length < 1) {
      return { valid: false, solved: false, reason: "Chain too short." };
    }

    // Still a structural requirement (not an anchor rule) - the alternating PLAYER/CLUB
    // pattern has to start somewhere, and a chain of player-club links only makes sense
    // starting on a player.
    if (chain[0].type !== "PLAYER") {
      return { valid: false, solved: false, reason: "Start with a player." };
    }

    if (chain.length === 1) {
      return { valid: true, solved: false, reason: "Ready for the next link.", chainLength: 1 };
    }

    for (let index = 0; index < chain.length - 1; index += 1) {
      const previousNode = chain[index];
      const currentNode = chain[index + 1];

      if (previousNode.type === "PLAYER" && currentNode.type !== "CLUB") {
        return {
          valid: false,
          solved: false,
          reason: `${await this.getPlayerName(previousNode.id)} should be followed by a club.`,
        };
      }

      if (previousNode.type === "CLUB" && currentNode.type !== "PLAYER") {
        return {
          valid: false,
          solved: false,
          reason: `${await this.getClubName(previousNode.id)} should be followed by a player.`,
        };
      }

      // No-repeat is intentionally not checked here - this mode allows revisiting the same
      // player/club as many times as the player likes.
      if (!(await this.graph.hasEdge(previousNode, currentNode))) {
        const player = previousNode.type === "PLAYER" ? previousNode : currentNode.type === "PLAYER" ? currentNode : null;
        const club = previousNode.type === "CLUB" ? previousNode : currentNode.type === "CLUB" ? currentNode : null;

        if (player && club) {
          const playerName = await this.getNodeLabel(player);
          const clubName = await this.getNodeLabel(club);

          if (playerName && clubName) {
            return { valid: false, solved: false, reason: `${playerName} didn't play at ${clubName}.` };
          }
        }

        return { valid: false, solved: false, reason: "This link is not valid." };
      }
    }

    // Solved as soon as every anchor has appeared anywhere among the chain's player nodes -
    // unlike daily mode, this doesn't require the chain to *end* on an anchor, since anchors
    // may be visited in any order/position here.
    const visitedPlayerIds = new Set(chain.filter((node) => node.type === "PLAYER").map((node) => node.id));
    const allAnchorsVisited = anchorPlayerIds.every((id) => visitedPlayerIds.has(id));

    if (allAnchorsVisited) {
      return { valid: true, solved: true, reason: "All anchors linked.", chainLength: chain.length };
    }

    return { valid: true, solved: false, reason: "Link looks good. Keep going.", chainLength: chain.length };
  }

  private async getNodeLabel(node: ChainNodeInput): Promise<string | null> {
    return node.type === "PLAYER" ? this.getPlayerName(node.id) : this.getClubName(node.id);
  }

  private async getPlayerName(playerId: number): Promise<string | null> {
    return (await this.graph.getNodeName({ id: playerId, type: "PLAYER" })) ?? `Player ${playerId}`;
  }

  private async getClubName(clubId: number): Promise<string | null> {
    return (await this.graph.getNodeName({ id: clubId, type: "CLUB" })) ?? `Club ${clubId}`;
  }
}
