import type { NodeType } from "../../domain/types";

export type NodeId = string;

export interface GraphNode {
  id: number;
  type: NodeType;
}

export interface GraphService {
  hasEdge(a: GraphNode, b: GraphNode): Promise<boolean>;
  getNodeName(node: GraphNode): Promise<string | null>;
  shortestPathPlayerToPlayer(startPlayerId: number, targetPlayerId: number): Promise<GraphNode[] | null>;
  // Same as shortestPathPlayerToPlayer, but the search can never route through any node in
  // `excluded` - used for in-progress hints, where suggesting an already-used player/club
  // would produce a step that then fails the no-repeat validation rule.
  shortestPathAvoiding(from: GraphNode, targetPlayerId: number, excluded: GraphNode[]): Promise<GraphNode[] | null>;
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
