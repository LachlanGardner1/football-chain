// NFD-decomposes accented characters into base letter + combining mark, then strips the
// combining marks - "Suárez" -> "Suarez". Without this, the transfermarkt import's
// ON CONFLICT (normalized_name) dedup can't tell "José" and "Jose" apart, risking the same
// kind of duplicate-row split found and fixed in
// db/migrations/007_merge_duplicate_clubs.sql for club names.
//
// NFD only decomposes characters that have a canonical base-letter + combining-mark form -
// letters like ø, đ, ł, æ, œ, ß have no such decomposition (they're distinct letters, not
// base+mark), so NFD alone leaves them untouched ('ødegaard'.normalize('NFD') === 'ødegaard').
// This explicit map runs first to cover them too.
//
// If you change this function's logic again, first run
// `npm run db:rebuild-normalized-names -- --dry-run` against production data to check for (and
// then, without --dry-run, merge) any normalized_name collisions the change causes - see
// db/migrations/010_merge_normalization_duplicate_players_and_clubs.sql for the incident this
// guards against, and scripts/data-import/rebuild-normalized-names.ts for the tool itself.
const NON_DECOMPOSING_LETTER_MAP: Record<string, string> = {
  ø: 'o', đ: 'd', ł: 'l', æ: 'ae', œ: 'oe', ß: 'ss',
};
const NON_DECOMPOSING_LETTER_PATTERN = /[øđłæœß]/g;

export function normalizeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(NON_DECOMPOSING_LETTER_PATTERN, (char) => NON_DECOMPOSING_LETTER_MAP[char])
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}
