import type { NodeType } from "./types";

// Canonical identity for a chain node, shared between the server-side validator
// and the client's optimistic repeat check so both agree on what "already used" means.
export function nodeKey(type: NodeType, id: number): string {
  return `${type}:${id}`;
}
