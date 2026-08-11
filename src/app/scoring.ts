export interface PuzzleScoreBreakdown {
  score: number;
  efficiencyBonus: number;
  invalidPenalty: number;
  completionBonus: number;
}

export interface PuzzleScoreInput {
  chainLength: number;
  optimalLength: number;
  invalidSubmissions: number;
  solved: boolean;
}

export function calculatePuzzleScore(input: PuzzleScoreInput): PuzzleScoreBreakdown {
  const baseScore = 1000;
  const invalidPenalty = input.invalidSubmissions * 150;

  const liveScore = Math.max(0, baseScore - invalidPenalty);

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
    completionBonus,
  };
}

export function resolveProgressScore(previousScore: number, nextScore: PuzzleScoreBreakdown, submissionWasValid: boolean): PuzzleScoreBreakdown {
  return {
    ...nextScore,
    score: nextScore.score,
  };
}
