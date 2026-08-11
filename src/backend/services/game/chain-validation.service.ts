import type { ChainNodeInput, ValidationResult } from "../../domain/types";
import type { ChainValidator } from "../../domain/repositories";
import type { GraphService } from "../graph/graph-types";
import { nodeKey } from "../../domain/chain-keys";

export class ChainValidationService implements ChainValidator {
  constructor(private readonly graph: GraphService) {}

  async validateChain(params: {
    chain: ChainNodeInput[];
    anchorPlayerIds: number[];
  }): Promise<ValidationResult> {
    const { chain, anchorPlayerIds } = params;

    // Empty chains are invalid because the puzzle cannot start without a first node.
    if (chain.length < 1) {
      console.info('[football-chain] chain-validation', { stage: 'too-short', chainLength: chain.length });
      return { valid: false, solved: false, reason: "Chain too short." };
    }

    const lastNode = chain[chain.length - 1];

    // The first submitted node must be one of the puzzle's anchor players.
    if (chain.length === 1) {
      if (lastNode.type !== "PLAYER") {
        console.info('[football-chain] chain-validation', { stage: 'invalid-start-type', chainLength: chain.length });
        return { valid: false, solved: false, reason: "Start with a player node." };
      }

      if (!anchorPlayerIds.includes(lastNode.id)) {
        console.info('[football-chain] chain-validation', { stage: 'invalid-start-player', chainLength: chain.length, anchorPlayerIds, actualStartPlayerId: lastNode.id });
        return { valid: false, solved: false, reason: "Start with one of the given players." };
      }

      console.info('[football-chain] chain-validation', { stage: 'start-ready', chainLength: chain.length });
      return { valid: true, solved: false, reason: "Ready for the next link.", chainLength: 1 };
    }

    // Every step must alternate PLAYER -> CLUB -> PLAYER -> CLUB, matching the gameplay loop.
    const seenKeys = new Set<string>();

    for (let index = 0; index < chain.length; index += 1) {
      const node = chain[index];
      const key = nodeKey(node.type, node.id);

      if (seenKeys.has(key)) {
        return {
          valid: false,
          solved: false,
          reason: node.type === "PLAYER"
            ? "You cannot reuse the same player in a chain."
            : "You cannot reuse the same club in a chain.",
        };
      }

      seenKeys.add(key);

      if (index === chain.length - 1) {
        continue;
      }

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

      // If the adjacent pair is not in the graph, report the specific missing relationship.
      if (!(await this.graph.hasEdge(previousNode, currentNode))) {
        const player = previousNode.type === "PLAYER" ? previousNode : currentNode.type === "PLAYER" ? currentNode : null;
        const club = previousNode.type === "CLUB" ? previousNode : currentNode.type === "CLUB" ? currentNode : null;

        if (player && club) {
          const playerName = await this.getNodeLabel(player);
          const clubName = await this.getNodeLabel(club);

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
      console.info('[football-chain] chain-validation', { stage: 'in-progress', chainLength: chain.length });
      return {
        valid: true,
        solved: false,
        reason: "Link looks good. Keep going.",
        chainLength: chain.length,
      };
    }

    // A player-ending chain is solved once it lands on any anchor player and every
    // anchor has appeared somewhere in the chain - order doesn't matter, the player
    // chooses which anchor to start on, which to end on, and how to visit the rest.
    if (lastNode.type === "PLAYER" && anchorPlayerIds.includes(lastNode.id)) {
      const visitedPlayerIds = new Set(chain.filter((node) => node.type === "PLAYER").map((node) => node.id));
      const allAnchorsVisited = anchorPlayerIds.every((id) => visitedPlayerIds.has(id));

      if (allAnchorsVisited) {
        console.info('[football-chain] chain-validation', { stage: 'solved', chainLength: chain.length, anchorPlayerIds });
        return {
          valid: true,
          solved: true,
          reason: "Puzzle completed.",
          chainLength: chain.length,
        };
      }
    }

    console.info('[football-chain] chain-validation', { stage: 'in-progress', chainLength: chain.length });
    return {
      valid: true,
      solved: false,
      reason: "Link looks good. Keep going.",
      chainLength: chain.length,
    };
  }

  private async getNodeLabel(node: ChainNodeInput): Promise<string | null> {
    if (node.type === "PLAYER") {
      return this.getPlayerName(node.id);
    }

    return this.getClubName(node.id);
  }

  private async getPlayerName(playerId: number): Promise<string | null> {
    return (await this.graph.getNodeName({ id: playerId, type: "PLAYER" })) ?? `Player ${playerId}`;
  }

  private async getClubName(clubId: number): Promise<string | null> {
    return (await this.graph.getNodeName({ id: clubId, type: "CLUB" })) ?? `Club ${clubId}`;
  }
}
