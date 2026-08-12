// Deliberately gentler than the 150-point invalid-submission penalty, since a hint is opt-in
// rather than a mistake.
export const HINT_PENALTY_POINTS = 100;

export interface PuzzleScoreBreakdown {
  score: number;
  efficiencyBonus: number;
  invalidPenalty: number;
  hintPenalty: number;
  completionBonus: number;
}

export interface PuzzleScoreInput {
  chainLength: number;
  optimalLength: number;
  invalidSubmissions: number;
  hintsUsed?: number;
  solved: boolean;
}

export function calculatePuzzleScore(input: PuzzleScoreInput): PuzzleScoreBreakdown {
  const baseScore = 1000;
  const invalidPenalty = input.invalidSubmissions * 150;
  const hintPenalty = (input.hintsUsed ?? 0) * HINT_PENALTY_POINTS;

  const liveScore = Math.max(0, baseScore - invalidPenalty - hintPenalty);

  const optimalRouteBonus = input.solved && input.chainLength === input.optimalLength ? 250 : 0;
  const zeroInvalidBonus = input.solved && input.invalidSubmissions === 0 ? 150 : 0;
  const completionBonus = optimalRouteBonus + zeroInvalidBonus;

  const score = input.solved
    ? Math.max(0, liveScore + completionBonus)
    : liveScore;

  console.info('[football-chain] score calculated', {
    chainLength: input.chainLength,
    optimalLength: input.optimalLength,
    invalidSubmissions: input.invalidSubmissions,
    hintsUsed: input.hintsUsed ?? 0,
    solved: input.solved,
    liveScore,
    optimalRouteBonus,
    zeroInvalidBonus,
    completionBonus,
    score,
  });

  return {
    score,
    efficiencyBonus: score,
    invalidPenalty,
    hintPenalty,
    completionBonus,
  };
}

export function resolveProgressScore(previousScore: number, nextScore: PuzzleScoreBreakdown, submissionWasValid: boolean): PuzzleScoreBreakdown {
  return {
    ...nextScore,
    score: nextScore.score,
  };
}
