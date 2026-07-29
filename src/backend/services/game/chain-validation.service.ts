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

    if (chain.length < 3) {
      return { valid: false, solved: false, reason: "Chain too short." };
    }

    if (chain[0].type !== "PLAYER" || chain[chain.length - 1].type !== "PLAYER") {
      return { valid: false, solved: false, reason: "Chain must start and end with player nodes." };
    }

    if (chain[0].id !== startPlayerId) {
      return { valid: false, solved: false, reason: "Start player does not match daily puzzle." };
    }

    for (let i = 0; i < chain.length - 1; i += 1) {
      const current = chain[i];
      const next = chain[i + 1];
      const expectedNextType = current.type === "PLAYER" ? "CLUB" : "PLAYER";

      if (next.type !== expectedNextType) {
        return {
          valid: false,
          solved: false,
          reason: `Invalid alternation at step ${i + 1}.`,
        };
      }

      if (!this.graph.hasEdge(current, next)) {
        return {
          valid: false,
          solved: false,
          reason: `Invalid connection at step ${i + 1}.`,
        };
      }
    }

    const solved = chain[chain.length - 1].id === targetPlayerId;

    return {
      valid: true,
      solved,
      chainLength: chain.length,
    };
  }
}
