export type NodeType = "PLAYER" | "CLUB";

export interface DataVersion {
  id: number;
  versionKey: string;
}

export interface Player {
  id: number;
  canonicalName: string;
  normalizedName: string;
}

export interface Club {
  id: number;
  canonicalName: string;
  normalizedName: string;
}

export interface DailyPuzzle {
  id: number;
  puzzleDate: string;
  anchorPlayerIds: number[];
  optimalLength: number;
  datasetVersionId: number;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
}

export interface ChainNodeInput {
  id: number;
  type: NodeType;
}

export interface ValidationResult {
  valid: boolean;
  solved: boolean;
  reason?: string;
  chainLength?: number;
}

export interface DailyPuzzleDTO {
  puzzleId: number;
  date: string;
  anchorPlayers: Array<{ id: number; name: string }>;
  optimalLength?: number;
}

export interface UserStatsDTO {
  solvedCount: number;
  currentStreak: number;
  maxStreak: number;
  bestChainLength: number | null;
}
