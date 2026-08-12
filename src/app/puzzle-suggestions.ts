import { nodeKey } from "../backend/domain/chain-keys";

export { nodeKey };

export type CatalogEntry = { id: number; name: string };

export type SuggestionEntry = CatalogEntry & {
  isAlreadyUsed: boolean;
};

export type ChainStepLike = { id: number | null; type: 'PLAYER' | 'CLUB' };

// Mirrors scripts/normalize-name.ts's accent-folding (NFD-decompose, strip combining marks)
// so typing the plain ASCII "Suarez" finds "Luis Suárez" in the suggestion dropdown - without
// this, a query and a name only match when the user types the accent themselves, which most
// players won't. Kept as a small local duplicate rather than a cross-module import since the
// two call sites (DB dedup-key normalization vs. client-side search) have no other reason to
// share code.
export function foldAccents(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

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
  const normalizedQuery = foldAccents(query.trim().toLowerCase());
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
    .filter((entry) => foldAccents(entry.name.toLowerCase()).includes(normalizedQuery))
    .map((entry) => ({
      ...entry,
      isAlreadyUsed: usedIds.has(expectedType ? `${expectedType}:${entry.id}` : `${entry.id}`),
    }));
}
