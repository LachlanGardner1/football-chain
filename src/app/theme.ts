export const THEME_STORAGE_KEY = 'football-chain:theme';
export type Theme = 'light' | 'dark';

export function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark';
}
