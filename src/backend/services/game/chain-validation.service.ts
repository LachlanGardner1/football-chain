import type { ChainNodeInput, ValidationResult } from "../../domain/types";
import type { ChainValidator } from "../../domain/repositories";
import type { GraphService } from "../graph/graph-types";

export class ChainValidationService implements ChainValidator {
  constructor(private readonly graph: GraphService) {}

  async validateChain(params: {
    chain: ChainNodeInput[];
    startPlayerId: number;
    targetPlayerId: number;
  }): Promise<ValidationResult> {
    const { chain, startPlayerId, targetPlayerId } = params;

    // Empty chains are invalid because the puzzle cannot start without a first node.
    if (chain.length < 1) {
      return { valid: false, solved: false, reason: "Chain too short." };
    }

    const lastNode = chain[chain.length - 1];

    // The first submitted node must be the puzzle's start player.
    if (chain.length === 1) {
      if (lastNode.type !== "PLAYER") {
        return { valid: false, solved: false, reason: "Start with a player node." };
      }

      if (lastNode.id !== startPlayerId) {
        return { valid: false, solved: false, reason: "Start player does not match daily puzzle." };
      }

      return { valid: true, solved: false, reason: "Ready for the next link.", chainLength: 1 };
    }

    // Every step must alternate PLAYER -> CLUB -> PLAYER -> CLUB, matching the gameplay loop.
    for (let index = 0; index < chain.length - 1; index += 1) {
      const previousNode = chain[index];
      const currentNode = chain[index + 1];

      if (previousNode.type === "PLAYER" && currentNode.type !== "CLUB") {
        return {
          valid: false,
          solved: false,
          reason: `${this.getPlayerName(previousNode.id)} should be followed by a club.`,
        };
      }

      if (previousNode.type === "CLUB" && currentNode.type !== "PLAYER") {
        return {
          valid: false,
          solved: false,
          reason: `${this.getClubName(previousNode.id)} should be followed by a player.`,
        };
      }

      // If the adjacent pair is not in the graph, report the specific missing relationship.
      if (!this.graph.hasEdge(previousNode, currentNode)) {
        const player = previousNode.type === "PLAYER" ? previousNode : currentNode.type === "PLAYER" ? currentNode : null;
        const club = previousNode.type === "CLUB" ? previousNode : currentNode.type === "CLUB" ? currentNode : null;

        if (player && club) {
          const playerName = this.getNodeLabel(player);
          const clubName = this.getNodeLabel(club);

          if (playerName && clubName) {
            return {
              valid: false,
              solved: false,
              reason: `${playerName} didn't play at ${clubName}.`,
            };
          }
        }

        return {
          valid: false,
          solved: false,
          reason: "This link is not valid.",
        };
      }
    }

    // A completed club step is still valid progress until the user confirms the next player.
    if (lastNode.type === "CLUB") {
      const targetNode = { id: targetPlayerId, type: "PLAYER" as const };
      if (this.graph.hasEdge(lastNode, targetNode)) {
        return {
          valid: true,
          solved: true,
          reason: "You reached the goal player.",
          chainLength: chain.length + 1,
        };
      }

      return {
        valid: true,
        solved: false,
        reason: "Link looks good. Keep going.",
        chainLength: chain.length,
      };
    }

    // If the chain ends on the target player, the puzzle is solved.
    if (lastNode.type === "PLAYER" && lastNode.id === targetPlayerId) {
      return {
        valid: true,
        solved: true,
        reason: "You reached the goal player.",
        chainLength: chain.length,
      };
    }

    // Any other player-ending chain is still a valid partial step and should not error.
    return {
      valid: true,
      solved: false,
      reason: "Link looks good. Keep going.",
      chainLength: chain.length,
    };
  }

  private getNodeLabel(node: ChainNodeInput): string | null {
    if (node.type === "PLAYER") {
      return this.getPlayerName(node.id);
    }

    return this.getClubName(node.id);
  }

  private getPlayerName(playerId: number): string | null {
    return this.graph.getNodeName({ id: playerId, type: "PLAYER" }) ?? `Player ${playerId}`;
  }

  private getClubName(clubId: number): string | null {
    return this.graph.getNodeName({ id: clubId, type: "CLUB" }) ?? `Club ${clubId}`;
  }
}
