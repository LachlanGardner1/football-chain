import type { NodeType } from "../../domain/types";

export type NodeId = string;

export interface GraphNode {
  id: number;
  type: NodeType;
}

export interface GraphBuildInput {
  datasetVersionId: number;
  edges: Array<{ playerId: number; clubId: number; playerName?: string; clubName?: string }>;
}

export interface GraphService {
  rebuild(input: GraphBuildInput): void;
  hasEdge(a: GraphNode, b: GraphNode): boolean;
  getNodeName(node: GraphNode): string | null;
  shortestPathPlayerToPlayer(startPlayerId: number, targetPlayerId: number): GraphNode[] | null;
}

export function toNodeId(node: GraphNode): NodeId {
  return `${node.type}:${node.id}`;
}

export function fromNodeId(nodeId: NodeId): GraphNode {
  const [type, idText] = nodeId.split(":");
  return {
    type: type as NodeType,
    id: Number(idText),
  };
}
