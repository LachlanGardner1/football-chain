// NFD-decomposes accented characters into base letter + combining mark, then strips the
// combining marks - "Suárez" -> "Suarez". Without this, the transfermarkt import's
// ON CONFLICT (normalized_name) dedup can't tell "José" and "Jose" apart, risking the same
// kind of duplicate-row split found and fixed in
// db/migrations/007_merge_duplicate_clubs.sql for club names.
export function normalizeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}
