import { nodeKey } from "../backend/domain/chain-keys";

export { nodeKey };

export type CatalogEntry = { id: number; name: string };

export type SuggestionEntry = CatalogEntry & {
  isAlreadyUsed: boolean;
};

export type ChainStepLike = { id: number | null; type: 'PLAYER' | 'CLUB' };

// Shared by both places page.tsx needs to know which player/club keys are already
// locked into the chain: the pre-submit repeat check and the autosuggest dropdown.
export function getUsedEntryKeys(
  steps: ChainStepLike[],
  stepValidationStates: Record<number, 'valid' | 'invalid' | 'repeat' | null | undefined>,
  options: { excludeIndex?: number; includeKeys?: Iterable<string> } = {},
): Set<string> {
  const keys = new Set(options.includeKeys ?? []);

  steps.forEach((step, index) => {
    if (index === options.excludeIndex) return;
    if (step.id === null) return;
    if (stepValidationStates[index] !== 'valid') return;

    keys.add(nodeKey(step.type, step.id));
  });

  return keys;
}

export function getVisibleCatalogEntries(
  entries: CatalogEntry[],
  query: string,
  usedEntryKeys: Iterable<number | string> = [],
  expectedType?: 'PLAYER' | 'CLUB',
): SuggestionEntry[] {
  const normalizedQuery = query.trim().toLowerCase();
  const usedIds = new Set(
    Array.from(usedEntryKeys).map((entry) => {
      if (typeof entry === 'string') {
        return entry;
      }

      return expectedType ? `${expectedType}:${entry}` : `${entry}`;
    }),
  );

  if (!normalizedQuery) {
    return [];
  }

  return entries
    .filter((entry) => entry.name.toLowerCase().includes(normalizedQuery))
    .map((entry) => ({
      ...entry,
      isAlreadyUsed: usedIds.has(expectedType ? `${expectedType}:${entry.id}` : `${entry.id}`),
    }));
}
