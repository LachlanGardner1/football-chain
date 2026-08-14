// The two hint buttons cost different amounts (see src/backend/services/hints/hint.service.ts,
// which mirrors these same two numbers), so calculatePuzzleScore takes a single precomputed
// hintPenalty total rather than a flat rate * a count.
export const ANCHOR_CLUB_HINT_PENALTY_POINTS = 50;
export const NEXT_STEPS_HINT_PENALTY_POINTS = 150;

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
  hintPenalty?: number;
  solved: boolean;
  // "Reveal next steps" hands you a concrete step toward the shortest route, so a chain that
  // only matches the optimal length because of that guidance isn't really a *perfect* chain -
  // revealing a club's identity (the other hint) doesn't affect routing the same way, so only
  // this one disqualifies the bonus.
  usedNextStepsHint?: boolean;
}

export function calculatePuzzleScore(input: PuzzleScoreInput): PuzzleScoreBreakdown {
  const baseScore = 1000;
  const invalidPenalty = input.invalidSubmissions * 150;
  const hintPenalty = input.hintPenalty ?? 0;

  const liveScore = Math.max(0, baseScore - invalidPenalty - hintPenalty);

  const optimalRouteBonus =
    input.solved && input.chainLength === input.optimalLength && !input.usedNextStepsHint ? 250 : 0;
  const zeroInvalidBonus = input.solved && input.invalidSubmissions === 0 ? 150 : 0;
  const completionBonus = optimalRouteBonus + zeroInvalidBonus;

  const score = input.solved
    ? Math.max(0, liveScore + completionBonus)
    : liveScore;

  console.info('[football-chain] score calculated', {
    chainLength: input.chainLength,
    optimalLength: input.optimalLength,
    invalidSubmissions: input.invalidSubmissions,
    hintPenalty,
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
