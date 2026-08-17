'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowsClockwise,
  CheckCircle,
  CloudCheck,
  Flag,
  Flame,
  Gauge,
  Lightbulb,
  Lock,
  Moon,
  SoccerBall,
  Sun,
  Sword,
  Trophy,
  XCircle,
} from '@phosphor-icons/react';

import { foldAccents, getUsedEntryKeys, getVisibleCatalogEntries, nodeKey } from './puzzle-suggestions';
import {
  ANCHOR_CLUB_HINT_PENALTY_POINTS,
  calculatePuzzleScore,
  NEXT_STEPS_HINT_PENALTY_POINTS,
  resolveProgressScore,
  type PuzzleScoreBreakdown,
} from './scoring';
import { isTheme, THEME_STORAGE_KEY, type Theme } from './theme';
import { apiFetch } from './api-fetch';
import DisplayNameModal from './components/DisplayNameModal';
import DailyLeaderboardPreview from './components/DailyLeaderboardPreview';

type Puzzle = {
  puzzleId: number;
  date: string;
  anchorPlayers: Array<{ id: number; name: string }>;
  optimalLength?: number;
};

type CatalogEntry = { id: number; name: string };

type ChainNode = { id: number | null; type: 'PLAYER' | 'CLUB' };

type ValidationResponse = {
  valid: boolean;
  solved: boolean;
  reason?: string;
  chainLength?: number;
};

type ServerStats = {
  solvedCount: number;
  currentStreak: number;
  maxStreak: number;
  bestChainLength: number | null;
  displayName: string | null;
};

type AvailableDates = {
  dates: string[];
  today: string;
};

type RevealAnchorClubResponse =
  | { kind: 'CLUB_REVEALED'; anchorPlayerId: number; clubId: number; clubName: string; hintPenalty: number }
  | { kind: 'NO_MORE_CLUBS'; anchorPlayerId: number; hintPenalty: number };

type RevealNextStepsResponse =
  | {
      kind: 'STEPS_REVEALED';
      fromNodeId: number;
      fromNodeType: 'PLAYER' | 'CLUB';
      fromLabel: string;
      steps: Array<{ id: number; type: 'PLAYER' | 'CLUB'; label: string }>;
      hintPenalty: number;
    }
  | { kind: 'NONE'; reason: string; hintPenalty: number };

type HintStateResponse = {
  revealedAnchorClubHints: Array<{ anchorPlayerId: number; clubId: number; clubName: string }>;
  nextStepHintsUsed: number;
  hintPenalty: number;
};

type PuzzleOutcome = {
  outcomeLocked: boolean;
  solved: boolean;
  failedAt: string | null;
  bestChainLength: number | null;
  lockedScore: number | null;
};

function sortMatches(a: CatalogEntry, b: CatalogEntry) {
  return a.name.localeCompare(b.name);
}

function logDebug(message: string, details?: Record<string, unknown>) {
  if (details) {
    console.info(`[football-chain] ${message}`, details);
    return;
  }

  console.info(`[football-chain] ${message}`);
}

export default function HomePage() {
  const [theme, setTheme] = useState<Theme>('dark');

  useEffect(() => {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (isTheme(stored)) {
      setTheme(stored);
    }
  }, []);

  function toggleTheme() {
    setTheme((current) => {
      const next: Theme = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
      return next;
    });
  }

  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [catalog, setCatalog] = useState<{ players: CatalogEntry[]; clubs: CatalogEntry[] }>({ players: [], clubs: [] });
  const [steps, setSteps] = useState<ChainNode[]>([{ id: null, type: 'PLAYER' }]);
  const [stepSearchValues, setStepSearchValues] = useState<Record<number, string>>({});
  const [stepShowSuggestions, setStepShowSuggestions] = useState<Record<number, boolean>>({});
  const [result, setResult] = useState<ValidationResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalidStepIndex, setInvalidStepIndex] = useState<number | null>(null);
  const [stepValidationStates, setStepValidationStates] = useState<Record<number, 'valid' | 'invalid' | 'repeat' | null>>({});
  const [shakeKey, setShakeKey] = useState(0);
  const [solved, setSolved] = useState(false);
  const [failed, setFailed] = useState(false);
  const [lockedOutcome, setLockedOutcome] = useState<PuzzleOutcome | null>(null);
  const [practiceMode, setPracticeMode] = useState(false);
  const [highlightedSuggestionIndex, setHighlightedSuggestionIndex] = useState<Record<number, number>>({});
  const [scoreBreakdown, setScoreBreakdown] = useState<PuzzleScoreBreakdown | null>(null);
  const [invalidSubmissions, setInvalidSubmissions] = useState(0);
  const [serverStats, setServerStats] = useState<ServerStats | null>(null);
  const [showNameModal, setShowNameModal] = useState(false);
  // Set right before either /api/complete POST call, consumed the next time fetchServerStats
  // resolves - the trigger for "show the name-entry modal" needs to fire only immediately after
  // a fresh lock-in, not on every routine stats refresh (e.g. the one on initial page load).
  const justLockedInRef = useRef(false);
  // NOT new Date().toISOString().slice(0, 10) - toISOString() converts to UTC first, so for
  // anyone meaningfully ahead of UTC (e.g. AEST/AEDT, UTC+10/+11) this silently shows
  // yesterday's date for several hours after their own local midnight. Build the date from
  // the browser's local getFullYear/getMonth/getDate instead, matching
  // src/app/api/daily/date.ts's todayLocalDateIso() (server-side equivalent for the no-date
  // request case).
  const [selectedDate, setSelectedDate] = useState(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  });
  const [availableDates, setAvailableDates] = useState<AvailableDates | null>(null);
  const [dateInputError, setDateInputError] = useState<string | null>(null);
  const [hintPenalty, setHintPenalty] = useState(0);
  const [revealedAnchorClubHints, setRevealedAnchorClubHints] = useState<Record<number, string[]>>({});
  const [exhaustedAnchors, setExhaustedAnchors] = useState<Set<number>>(new Set());
  const [anchorHintLoading, setAnchorHintLoading] = useState<Record<number, boolean>>({});
  const [nextStepsReveal, setNextStepsReveal] = useState<{ fromLabel: string; steps: Array<{ label: string; type: 'PLAYER' | 'CLUB' }> } | null>(null);
  const [nextStepsLoading, setNextStepsLoading] = useState(false);
  const [nextStepsMessage, setNextStepsMessage] = useState<string | null>(null);
  // Once a player step validates, the next (club) row narrows from a free-text search over the
  // whole catalog to a dropdown of just that player's real clubs - keyed by player id so it's
  // naturally shared/cached if the same player is ever looked up twice in one session.
  const [playerClubsCache, setPlayerClubsCache] = useState<Record<number, CatalogEntry[]>>({});
  const playerClubsFetchedRef = useRef<Set<number>>(new Set());
  const validationRequestIdRef = useRef(0);
  const invalidSubmissionCountRef = useRef(0);
  // Hints are a shared pool server-side (spending one during the official round still counts
  // if spent again during a later practice round), so the server always reports the *true
  // cumulative* penalty for this (user, puzzle) pair. rawHintPenaltyRef tracks that raw total;
  // hintPenaltyBaselineRef is a snapshot of it taken whenever a fresh attempt starts (initial
  // load, or "play for fun"), so `hintPenalty` state can show only *this attempt's* spend -
  // letting a practice round start from a clean 1000 to show what was actually achievable,
  // even though the underlying hint records are still shared.
  const rawHintPenaltyRef = useRef(0);
  const hintPenaltyBaselineRef = useRef(0);
  // Disqualifies the optimal-route ("perfect chain") bonus once "reveal next steps" has
  // actually handed out a real step this attempt - see scoring.ts's usedNextStepsHint. Hydrated
  // from the server's nextStepHintsUsed count on load (so a mid-attempt refresh doesn't
  // spuriously re-qualify), and re-baselined to false on a fresh practice round alongside the
  // other hint-display state, matching the existing "practice round starts clean" pattern.
  const usedNextStepsHintRef = useRef(false);

  function applyServerHintPenalty(rawTotal: number) {
    rawHintPenaltyRef.current = rawTotal;
    setHintPenalty(Math.max(0, rawTotal - hintPenaltyBaselineRef.current));
  }

  const sortedPlayers = useMemo(() => [...catalog.players].sort(sortMatches), [catalog.players]);
  const sortedClubs = useMemo(() => [...catalog.clubs].sort(sortMatches), [catalog.clubs]);
  const catalogLookup = useMemo(
    () => ({
      players: new Map(sortedPlayers.map((entry) => [entry.id, entry.name] as const)),
      clubs: new Map(sortedClubs.map((entry) => [entry.id, entry.name] as const)),
    }),
    [sortedPlayers, sortedClubs],
  );

  function fetchServerStats() {
    apiFetch('/api/me/stats')
      .then((res) => res.json())
      .then((data: ServerStats) => {
        setServerStats(data);
        if (justLockedInRef.current) {
          justLockedInRef.current = false;
          const dismissedKey = `fc_display_name_dismissed_${selectedDate}`;
          if (!data.displayName && !window.sessionStorage.getItem(dismissedKey)) {
            setShowNameModal(true);
          }
        }
      })
      .catch(() => undefined);
  }

  function fetchAvailableDates() {
    apiFetch('/api/daily/dates')
      .then((res) => res.json())
      .then((data: AvailableDates) => setAvailableDates(data))
      .catch(() => undefined);
  }

  // Hydrates already-revealed hints on load (e.g. after a refresh) without spending a new
  // one - the anchor_club_hints table is the source of truth, this just mirrors it locally.
  // Takes optimalLength directly (rather than reading puzzle state) because this runs from
  // inside loadPuzzle's callback, before the just-set puzzle state has actually re-rendered -
  // going through updateScore's `puzzle` closure here would silently no-op on a stale null.
  function fetchHintState(puzzleId: number, optimalLength: number | undefined) {
    apiFetch(`/api/hint?puzzleId=${puzzleId}`)
      .then((res) => res.json())
      .then((data: HintStateResponse) => {
        const revealed: Record<number, string[]> = {};
        for (const hint of data.revealedAnchorClubHints) {
          (revealed[hint.anchorPlayerId] ??= []).push(hint.clubName);
        }
        setRevealedAnchorClubHints(revealed);
        applyServerHintPenalty(data.hintPenalty);
        const effectiveHintPenalty = Math.max(0, data.hintPenalty - hintPenaltyBaselineRef.current);
        usedNextStepsHintRef.current = data.nextStepHintsUsed > 0;
        // A fresh page load always starts with an empty confirmed chain, but hints spent in
        // an earlier visit are still real - without this, the score display would
        // misleadingly show 1000 until the next submission.
        setScoreBreakdown(
          calculatePuzzleScore({
            chainLength: 0,
            optimalLength: optimalLength ?? 1,
            invalidSubmissions: 0,
            hintPenalty: effectiveHintPenalty,
            solved: false,
            usedNextStepsHint: usedNextStepsHintRef.current,
          }),
        );
      })
      .catch(() => undefined);
  }

  // Hydrates whatever outcome is already locked in for this puzzle (e.g. after a refresh, or
  // returning to a puzzle already played earlier today) - drives the "already played" summary.
  function fetchPuzzleOutcome(puzzleId: number) {
    apiFetch(`/api/complete?puzzleId=${puzzleId}`)
      .then((res) => res.json())
      .then((data: PuzzleOutcome) => setLockedOutcome(data))
      .catch(() => undefined);
  }

  useEffect(() => {
    fetchAvailableDates();
  }, []);

  function loadPuzzle(date: string) {
    setLoading(true);
    setError(null);
    fetchServerStats();

    Promise.all([apiFetch(`/api/daily?date=${encodeURIComponent(date)}`).then((res) => res.json()), apiFetch('/api/catalog').then((res) => res.json())])
      .then(([puzzleData, catalogData]) => {
        if (puzzleData.error) {
          setError(puzzleData.error);
          return;
        }
        setPuzzle(puzzleData);
        setCatalog(catalogData);
        logDebug('Loaded puzzle payload', {
          puzzleId: puzzleData.puzzleId,
          date,
          optimalLength: puzzleData.optimalLength,
          anchorPlayers: puzzleData.anchorPlayers?.map((player: { name: string }) => player.name),
        });
        setSteps([{ id: null, type: 'PLAYER' }]);
        setStepSearchValues({});
        setStepShowSuggestions({});
        setSolved(false);
        setFailed(false);
        setLockedOutcome(null);
        setPracticeMode(false);
        setResult(null);
        setError(null);
        setInvalidStepIndex(null);
        setStepValidationStates({});
        setScoreBreakdown(null);
        setInvalidSubmissions(0);
        invalidSubmissionCountRef.current = 0;
        setNextStepsReveal(null);
        setNextStepsMessage(null);
        rawHintPenaltyRef.current = 0;
        hintPenaltyBaselineRef.current = 0;
        usedNextStepsHintRef.current = false;
        setHintPenalty(0);
        setRevealedAnchorClubHints({});
        setExhaustedAnchors(new Set());
        setAnchorHintLoading({});
        if (puzzleData.puzzleId) {
          fetchHintState(puzzleData.puzzleId, puzzleData.optimalLength);
          fetchPuzzleOutcome(puzzleData.puzzleId);
        }
        setLoading(false);
      })
      .catch(() => setError('Unable to load puzzle data.'));
  }

  useEffect(() => {
    loadPuzzle(selectedDate);
  }, [selectedDate]);

  const remainingAnchorPlayers = useMemo(() => {
    if (!puzzle) return [];

    // Only a *confirmed* (valid) step counts as visiting an anchor - a step that's merely
    // filled in (typed/selected but not yet submitted, or submitted and rejected) must not
    // remove that anchor from "Still needed".
    const playerIdsInChain = steps
      .filter((step, index) => step.id !== null && step.type === 'PLAYER' && stepValidationStates[index] === 'valid')
      .map((step) => step.id as number);

    return puzzle.anchorPlayers.filter((player) => !playerIdsInChain.includes(player.id));
  }, [puzzle, steps, stepValidationStates]);

  function fetchPlayerClubs(playerId: number) {
    if (playerClubsFetchedRef.current.has(playerId)) return;
    playerClubsFetchedRef.current.add(playerId);

    apiFetch(`/api/player/${playerId}/clubs`)
      .then((res) => res.json())
      .then((data: { clubs: CatalogEntry[] }) => {
        setPlayerClubsCache((current) => ({ ...current, [playerId]: data.clubs }));
      })
      .catch(() => {
        // Allow a retry later - the render falls back to free-text search until this resolves.
        playerClubsFetchedRef.current.delete(playerId);
      });
  }

  function appendNextStep() {
    setSteps((current) => {
      const nextIndex = current.length;
      const expectedType = nextIndex % 2 === 0 ? 'PLAYER' : 'CLUB';
      if (expectedType === 'CLUB') {
        const precedingPlayerId = current[current.length - 1]?.id;
        if (precedingPlayerId !== null && precedingPlayerId !== undefined) {
          fetchPlayerClubs(precedingPlayerId);
        }
      }
      return [...current, { id: null, type: expectedType }];
    });
    setStepSearchValues((current) => ({ ...current, [steps.length]: '' }));
    setStepShowSuggestions((current) => ({ ...current, [steps.length]: false }));
    setInvalidStepIndex(null);
  }

  function updateStep(index: number, next: ChainNode) {
    setSteps((current) => current.map((node, nodeIndex) => (nodeIndex === index ? next : node)));
  }

  function selectSuggestion(index: number, entry: CatalogEntry, expectedType: 'PLAYER' | 'CLUB') {
    updateStep(index, { id: entry.id, type: expectedType });
    setStepSearchValues((current) => ({ ...current, [index]: entry.name }));
    setStepShowSuggestions((current) => ({ ...current, [index]: false }));
    setHighlightedSuggestionIndex((current) => ({ ...current, [index]: 0 }));
    setStepValidationStates((current) => ({ ...current, [index]: null }));
  }

  // Locks in a loss the first time it fires for this (user, puzzle) - the backend safely
  // no-ops the official record if an earlier call (win or loss) already locked it, so this is
  // also what fires when a replay/practice round runs the score back down to 0.
  function handleFailure(chainLengthAtFailure: number, score: number) {
    if (!puzzle || failed || solved) return;
    setFailed(true);
    justLockedInRef.current = true;

    apiFetch('/api/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        puzzleId: puzzle.puzzleId,
        outcome: 'FAILED',
        // best_chain_length has a DB check constraint of NULL or > 0 - a failure with no
        // confirmed steps yet has no meaningful chain length to record.
        chainLength: chainLengthAtFailure > 0 ? chainLengthAtFailure : undefined,
        score,
      }),
    })
      .then(() => {
        fetchServerStats();
        fetchPuzzleOutcome(puzzle.puzzleId);
      })
      .catch(() => undefined);
  }

  function updateScore(nextChainLength: number, solved: boolean, nextInvalidSubmissions: number, nextHintPenalty: number = hintPenalty) {
    if (!puzzle) return undefined;

    const nextScore = calculatePuzzleScore({
      chainLength: nextChainLength,
      optimalLength: puzzle.optimalLength ?? 1,
      invalidSubmissions: nextInvalidSubmissions,
      hintPenalty: nextHintPenalty,
      solved,
      usedNextStepsHint: usedNextStepsHintRef.current,
    });

    logDebug('Score update', {
      chainLength: nextChainLength,
      optimalLength: puzzle.optimalLength ?? 1,
      invalidSubmissions: nextInvalidSubmissions,
      hintPenalty: nextHintPenalty,
      solved,
      score: nextScore.score,
      completionBonus: nextScore.completionBonus,
      invalidPenalty: nextScore.invalidPenalty,
    });

    setScoreBreakdown((currentBreakdown) => {
      if (solved) {
        return nextScore;
      }

      const previousScore = currentBreakdown?.score ?? 1000;
      return resolveProgressScore(previousScore, nextScore, true);
    });

    if (!solved && nextScore.score === 0) {
      handleFailure(nextChainLength, nextScore.score);
    }

    // Callers that need the score for this exact update (e.g. to lock it in via
    // /api/complete) can't safely read the `scoreBreakdown` state right after calling this -
    // setState is async, so it would still hold the *previous* render's value.
    return nextScore;
  }

  async function validateCurrentStep(index: number) {
    if (!puzzle || steps[index]?.id === null) return;

    const usedEntryKeys = getUsedEntryKeys(steps, stepValidationStates, {
      excludeIndex: index,
    });
    const selectedEntryId = steps[index]?.id;
    const selectedEntryType = steps[index]?.type;
    const selectedEntryKey = selectedEntryId !== null && selectedEntryId !== undefined && selectedEntryType
      ? nodeKey(selectedEntryType, selectedEntryId)
      : null;
    const isRepeatedLink = selectedEntryKey !== null && usedEntryKeys.has(selectedEntryKey);

    if (isRepeatedLink) {
      invalidSubmissionCountRef.current += 1;
      const nextInvalidSubmissions = invalidSubmissionCountRef.current;
      setInvalidSubmissions(nextInvalidSubmissions);
      updateScore(steps.slice(0, index + 1).filter((step) => step.id !== null).length, false, nextInvalidSubmissions);

      setResult({ valid: false, solved: false, reason: 'This link repeats a previously used option.' });
      setStepValidationStates((current) => ({ ...current, [index]: 'repeat' }));
      setInvalidStepIndex(null);
      setShakeKey((value) => value + 1);
      setLoading(false);
      return;
    }

    const chainToValidate = steps.slice(0, index + 1).map((step) => ({ id: step.id as number, type: step.type }));
    const anchorPlayerIds = puzzle.anchorPlayers.map((player) => player.id);
    const requestId = validationRequestIdRef.current + 1;
    validationRequestIdRef.current = requestId;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await apiFetch('/api/validate-chain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          anchorPlayerIds,
          chain: chainToValidate,
        }),
      });

      const data = (await response.json()) as ValidationResponse;
      if (requestId !== validationRequestIdRef.current) {
        return;
      }

      setResult(data);

      const nextInvalidSubmissions = data.valid ? invalidSubmissionCountRef.current : invalidSubmissionCountRef.current + 1;
      invalidSubmissionCountRef.current = nextInvalidSubmissions;
      setInvalidSubmissions(nextInvalidSubmissions);
      logDebug('Validation response', {
        index,
        valid: data.valid,
        solved: data.solved,
        reason: data.reason,
        chainLength: data.chainLength ?? chainToValidate.length,
        invalidSubmissions: nextInvalidSubmissions,
        optimalLength: puzzle.optimalLength ?? 1,
      });
      const nextScore = updateScore(data.chainLength ?? chainToValidate.length, data.solved, nextInvalidSubmissions);

      setStepValidationStates((current) => ({ ...current, [index]: data.valid ? 'valid' : 'invalid' }));

      if (!data.valid) {
        setInvalidStepIndex(index);
        setShakeKey((value) => value + 1);
      } else {
        setInvalidStepIndex(null);
        if (data.solved) {
          logDebug('Puzzle solved', {
            chainLength: data.chainLength ?? chainToValidate.length,
            optimalLength: puzzle.optimalLength ?? 1,
            invalidSubmissions: invalidSubmissionCountRef.current,
          });
          setSolved(true);
          justLockedInRef.current = true;

          apiFetch('/api/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              puzzleId: puzzle.puzzleId,
              outcome: 'SOLVED',
              chainLength: data.chainLength ?? chainToValidate.length,
              score: nextScore?.score ?? 0,
            }),
          })
            .then(() => {
              fetchServerStats();
              fetchPuzzleOutcome(puzzle.puzzleId);
            })
            .catch(() => undefined);
        } else if (index === steps.length - 1) {
          appendNextStep();
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to validate link.');
    } finally {
      if (requestId === validationRequestIdRef.current) {
        setLoading(false);
      }
    }
  }

  function getDisplayLabel(node: ChainNode) {
    if (node.id === null) {
      return 'Select an option';
    }

    const label = (node.type === 'PLAYER' ? catalogLookup.players : catalogLookup.clubs).get(node.id);
    return label ?? 'Select an option';
  }

  const chainTrail = useMemo(() => {
    if (!puzzle) return [];

    const trail: Array<{ type: 'PLAYER' | 'CLUB'; label: string; key: string }> = [];

    steps.forEach((step, index) => {
      if (step.id === null || stepValidationStates[index] !== 'valid') return;
      trail.push({ type: step.type, label: getDisplayLabel(step), key: `${step.type}-${step.id}-${index}` });
    });

    return trail;
  }, [puzzle, steps, catalog, stepValidationStates]);

  function resetPuzzle() {
    if (!puzzle) return;
    // The official result for today only ever locks in on the FIRST terminal outcome (see
    // GameResultRepository.upsertAttempt) - once that's happened, any further round is just
    // for fun, so flip into practice framing rather than implying this replay is official.
    const enteringPracticeMode = Boolean(lockedOutcome?.outcomeLocked);
    if (enteringPracticeMode) {
      setPracticeMode(true);
    }
    setSteps([{ id: null, type: 'PLAYER' }]);
    setStepSearchValues({});
    setStepShowSuggestions({});
    setSolved(false);
    setFailed(false);
    setResult(null);
    setError(null);
    setInvalidStepIndex(null);
    setStepValidationStates({});
    setInvalidSubmissions(0);
    invalidSubmissionCountRef.current = 0;
    setShakeKey((value) => value + 1);
    setNextStepsReveal(null);
    setNextStepsMessage(null);

    let hintPenaltyForDisplay = hintPenalty;
    if (enteringPracticeMode) {
      // The hint records themselves are still a shared pool with the official attempt (see
      // rawHintPenaltyRef/hintPenaltyBaselineRef above) - re-baselining here just means only
      // *new* hint spend counts against the display for this round, so a practice round starts
      // clean and shows the player what they could still achieve.
      hintPenaltyBaselineRef.current = rawHintPenaltyRef.current;
      hintPenaltyForDisplay = 0;
      usedNextStepsHintRef.current = false;
      setHintPenalty(0);
      setRevealedAnchorClubHints({});
      setExhaustedAnchors(new Set());
      setAnchorHintLoading({});
    }

    // Recompute (rather than null it out) so the score display is accurate immediately -
    // otherwise it would misleadingly flash a stale value until the next submission.
    setScoreBreakdown(
      calculatePuzzleScore({
        chainLength: 0,
        optimalLength: puzzle.optimalLength ?? 1,
        invalidSubmissions: 0,
        hintPenalty: hintPenaltyForDisplay,
        solved: false,
        usedNextStepsHint: usedNextStepsHintRef.current,
      }),
    );
  }

  function confirmedChainForHints() {
    return steps
      .filter((step, index) => step.id !== null && stepValidationStates[index] === 'valid')
      .map((step) => ({ id: step.id as number, type: step.type }));
  }

  async function revealAnchorClub(anchorPlayerId: number) {
    if (!puzzle || anchorHintLoading[anchorPlayerId]) return;

    setAnchorHintLoading((current) => ({ ...current, [anchorPlayerId]: true }));

    try {
      const response = await apiFetch('/api/hint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reveal-anchor-club',
          puzzleId: puzzle.puzzleId,
          anchorPlayerId,
          chain: confirmedChainForHints(),
        }),
      });

      const data = (await response.json()) as RevealAnchorClubResponse;
      applyServerHintPenalty(data.hintPenalty);
      const effectiveHintPenalty = Math.max(0, data.hintPenalty - hintPenaltyBaselineRef.current);

      if (data.kind === 'CLUB_REVEALED') {
        setRevealedAnchorClubHints((current) => ({
          ...current,
          [anchorPlayerId]: [...(current[anchorPlayerId] ?? []), data.clubName],
        }));
      } else {
        setExhaustedAnchors((current) => new Set(current).add(anchorPlayerId));
      }

      updateScore(chainTrail.length, solved, invalidSubmissionCountRef.current, effectiveHintPenalty);
    } catch {
      // Swallow - the button just stays enabled so the player can retry.
    } finally {
      setAnchorHintLoading((current) => ({ ...current, [anchorPlayerId]: false }));
    }
  }

  async function revealNextSteps() {
    if (!puzzle || nextStepsLoading) return;

    setNextStepsLoading(true);
    setNextStepsMessage(null);

    try {
      const response = await apiFetch('/api/hint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reveal-next-steps', puzzleId: puzzle.puzzleId, chain: confirmedChainForHints() }),
      });

      const data = (await response.json()) as RevealNextStepsResponse;
      applyServerHintPenalty(data.hintPenalty);
      const effectiveHintPenalty = Math.max(0, data.hintPenalty - hintPenaltyBaselineRef.current);

      if (data.kind === 'STEPS_REVEALED') {
        usedNextStepsHintRef.current = true;
        setNextStepsReveal({ fromLabel: data.fromLabel, steps: data.steps.map((step) => ({ label: step.label, type: step.type })) });
      } else {
        setNextStepsReveal(null);
        setNextStepsMessage(data.reason);
      }

      updateScore(chainTrail.length, solved, invalidSubmissionCountRef.current, effectiveHintPenalty);
    } catch (err) {
      setNextStepsMessage(err instanceof Error ? err.message : 'Unable to get a hint right now.');
    } finally {
      setNextStepsLoading(false);
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!puzzle) return;

    const lastCompletedStepIndex = steps.reduce<number | null>((lastIndex, step, index) => (step.id !== null ? index : lastIndex), null);
    if (lastCompletedStepIndex === null) {
      setError('Pick a valid first step before submitting.');
      return;
    }

    await validateCurrentStep(lastCompletedStepIndex);
  }

  const anchorPlayersSorted = useMemo(
    () => (puzzle ? [...puzzle.anchorPlayers].sort(sortMatches) : []),
    [puzzle],
  );

  const isPastPuzzle = Boolean(puzzle && availableDates && puzzle.date !== availableDates.today);

  // Shown in place of the chain-building form when this puzzle already has an official result
  // from earlier (a previous visit today, or any prior day for an archive puzzle) and nothing
  // has happened yet THIS session - once the player acts (solves/fails/starts a practice
  // round), their current activity takes over and this summary steps aside.
  const showAlreadyPlayedSummary = Boolean(lockedOutcome?.outcomeLocked && !practiceMode && !solved && !failed);

  function handleDateInputChange(nextValue: string) {
    if (availableDates && !availableDates.dates.includes(nextValue)) {
      setDateInputError('No puzzle was published on that date.');
      return;
    }

    setDateInputError(null);
    setSelectedDate(nextValue);
  }

  return (
    <main className="page">
      <header className="header">
        <div className="header-inner">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              <SoccerBall size={26} weight="duotone" />
            </span>
            <div>
              <h1 className="brand-title">Football Chain</h1>
              <p className="brand-subtitle">Link the squad, one transfer at a time.</p>
            </div>
          </div>
          <div className="header-actions">
            <Link href="/leaderboard" className="duel-button" title="See daily high scores and duel rankings">
              <Trophy size={16} weight="fill" />
              Leaderboard
            </Link>
            <Link href="/speed" className="duel-button" title="Race a friend 1v1 in real time">
              <Sword size={16} weight="fill" />
              Duel
            </Link>
            <button
              type="button"
              onClick={toggleTheme}
              className="theme-toggle"
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? <Sun size={18} weight="fill" /> : <Moon size={18} weight="fill" />}
            </button>
            <div className="brand-badge">Daily puzzle</div>
          </div>
        </div>
      </header>

      <div className="container">
        <section className="panel">
          <h2 className="panel-title">Today&apos;s puzzle</h2>
          {puzzle ? (
            <>
              <div className="required-sequence">
                {anchorPlayersSorted.map((player) => {
                  const visited = !remainingAnchorPlayers.some((remaining) => remaining.id === player.id);
                  return (
                    <div key={player.id} className={`req-chip${visited ? ' req-chip--visited' : ''}`}>
                      {visited ? <CheckCircle size={14} weight="fill" className="req-chip-icon" /> : null}
                      <span>{player.name}</span>
                    </div>
                  );
                })}
              </div>
              <p className="hint" style={{ marginBottom: 0 }}>
                Start and end on any two of these players. Include the rest somewhere in the chain, in any order.
                Build the chain by submitting a player, then a club they played for, then another player from that
                club, and so on - alternating player and club - until you&apos;ve linked every player above into one
                continuous sequence.
              </p>

              <div className="field-row">
                <label htmlFor="puzzle-date" className="field-label">
                  Puzzle date
                </label>
                <input
                  id="puzzle-date"
                  type="date"
                  value={selectedDate}
                  min={availableDates?.dates[0]}
                  max={availableDates?.today}
                  onChange={(event) => handleDateInputChange(event.target.value)}
                  className="date-input"
                />
                <span className="hint">
                  {dateInputError ?? 'Go back to a previously published puzzle, or play today\'s.'}
                </span>
              </div>
              {isPastPuzzle ? (
                <p className="hint" style={{ marginTop: 8, marginBottom: 0 }}>
                  You&apos;re viewing a past puzzle. Solving it won&apos;t count toward your streak.
                </p>
              ) : null}

              <details className="rules-details">
                <summary>How scoring &amp; streaks work</summary>
                <ul className="rules-list">
                  <li>Once you submit a link, it&apos;s locked in - there&apos;s no undoing a submission.</li>
                  <li>Wrong or repeated links cost 150 points each.</li>
                  <li>
                    Hints cost points too: revealing a club is -{ANCHOR_CLUB_HINT_PENALTY_POINTS}, revealing the next steps is -{NEXT_STEPS_HINT_PENALTY_POINTS}.
                  </li>
                  <li>Solve with zero wrong or repeated links for a +150 bonus.</li>
                  <li>
                    Solve using the shortest possible chain for a +250 &quot;perfect chain&quot; bonus - but using
                    &quot;Reveal next steps&quot; disqualifies you from this bonus, since it hands you the route
                    instead of you finding it yourself.
                  </li>
                  <li>If your score hits 0, the round ends as a loss for today&apos;s puzzle - and it breaks your streak immediately.</li>
                  <li>Only your first result each day is official. After that, you can keep playing the same puzzle for fun without changing your score or streak.</li>
                </ul>
              </details>
            </>
          ) : (
            <p className="hint">{error ?? 'Loading...'}</p>
          )}
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2 className="panel-title">Build a chain</h2>
            <div className="step-count">
              {steps.length} step{steps.length === 1 ? '' : 's'}
            </div>
          </div>

          <div className="legend">
            <span className="legend-item legend-item--valid">
              <CheckCircle size={15} weight="fill" />
              Valid
            </span>
            <span className="legend-item legend-item--invalid">
              <XCircle size={15} weight="fill" />
              Invalid
            </span>
            <span className="legend-item legend-item--repeat">
              <ArrowsClockwise size={15} weight="bold" />
              Repeat
            </span>
          </div>

          <div className="chain-trail" aria-label="Current chain">
            {chainTrail.map((node, index) => (
              <span className="chain-trail-item" key={node.key}>
                {index > 0 ? <span className="chain-connector" aria-hidden="true" /> : null}
                <span className={`chain-link chain-link--${node.type === 'PLAYER' ? 'player' : 'club'}`}>{node.label}</span>
              </span>
            ))}
          </div>

          {remainingAnchorPlayers.length > 0 ? (
            <div className="callout">
              <div className="callout-title">Still needed</div>
              <div className="anchor-reveal-list">
                {remainingAnchorPlayers.map((player) => {
                  const revealedClubs = revealedAnchorClubHints[player.id] ?? [];
                  const isExhausted = exhaustedAnchors.has(player.id);
                  const isLoading = Boolean(anchorHintLoading[player.id]);

                  return (
                    <div key={player.id} className="anchor-reveal-row">
                      <span className="callout-chip">
                        {player.name}
                        {revealedClubs.length > 0 ? (
                          <span className="callout-chip-hint"> — {revealedClubs.join(', ')}</span>
                        ) : null}
                      </span>
                      <button
                        type="button"
                        onClick={() => revealAnchorClub(player.id)}
                        disabled={isLoading || isExhausted}
                        className="btn btn-hint btn-hint--small"
                      >
                        <Lightbulb size={13} weight="fill" />
                        {isExhausted ? 'No more clubs' : isLoading ? 'Revealing...' : `Reveal club (-${ANCHOR_CLUB_HINT_PENALTY_POINTS})`}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {!solved ? (
            <div className="hint-row">
              <button
                type="button"
                onClick={revealNextSteps}
                disabled={nextStepsLoading || !puzzle}
                className="btn btn-hint"
              >
                <Lightbulb size={15} weight="fill" />
                {nextStepsLoading ? 'Revealing...' : `Reveal next steps (-${NEXT_STEPS_HINT_PENALTY_POINTS})`}
              </button>
              {nextStepsReveal ? (
                <span className="hint-text">
                  From <strong>{nextStepsReveal.fromLabel}</strong>, try:{' '}
                  {nextStepsReveal.steps.map((step, index) => (
                    <strong key={index}>
                      {index > 0 ? ' → ' : ''}
                      {step.label}
                    </strong>
                  ))}
                </span>
              ) : nextStepsMessage ? (
                <span className="hint-text">{nextStepsMessage}</span>
              ) : (
                <span className="hint-text">Reveals up to 2 links ahead toward the nearest anchor.</span>
              )}
            </div>
          ) : null}

          <p className="helper-text">Build the chain step by step. Start on any given player, finish on any given player, and include the rest along the way.</p>

          <div className="stat-grid">
            <div className="stat-card">
              <span className="stat-icon">
                <Flag size={16} weight="fill" />
              </span>
              <div>
                <div className="stat-label">Anchors</div>
                <div className="stat-value stat-value--mono">
                  {puzzle ? puzzle.anchorPlayers.length - remainingAnchorPlayers.length : 0} / {puzzle?.anchorPlayers.length ?? 0}
                </div>
              </div>
            </div>
            <div className="stat-card">
              <span className="stat-icon">
                <Gauge size={16} weight="fill" />
              </span>
              <div>
                <div className="stat-label">Current score</div>
                <div className="stat-value stat-value--mono">{scoreBreakdown?.score ?? 1000}</div>
                <div className="stat-sub">invalid -{scoreBreakdown?.invalidPenalty ?? 0} · hints -{scoreBreakdown?.hintPenalty ?? 0}</div>
              </div>
            </div>
            <div className="stat-card">
              <span className="stat-icon">
                <Lock size={16} weight="fill" />
              </span>
              <div>
                <div className="stat-label">Today&apos;s score</div>
                <div className="stat-value stat-value--mono">
                  {lockedOutcome?.outcomeLocked ? lockedOutcome.lockedScore ?? 0 : '—'}
                </div>
                <div className="stat-sub">
                  {lockedOutcome?.outcomeLocked ? (lockedOutcome.solved ? 'locked in' : 'locked in (loss)') : 'not locked in yet'}
                </div>
              </div>
            </div>
            <div className="stat-card">
              <span className="stat-icon">
                <Flame size={16} weight="fill" />
              </span>
              <div>
                <div className="stat-label">Streak</div>
                <div className="stat-value stat-value--mono">{serverStats?.currentStreak ?? 0}</div>
                <div className="stat-sub">best {serverStats?.maxStreak ?? 0}</div>
              </div>
            </div>
            <div className="stat-card">
              <span className="stat-icon">
                <CloudCheck size={16} weight="fill" />
              </span>
              <div>
                <div className="stat-label">Solves</div>
                <div className="stat-value stat-value--mono">{serverStats?.solvedCount ?? 0}</div>
                <div className="stat-sub">lifetime</div>
              </div>
            </div>
          </div>

          {showAlreadyPlayedSummary ? (
            <div className="solved-panel">
              <h3 className="solved-title">
                {lockedOutcome?.solved ? <Trophy size={22} weight="fill" /> : <XCircle size={22} weight="fill" />}
                {lockedOutcome?.solved ? "You already solved today's puzzle" : "You already played today's puzzle"}
              </h3>
              <p className="solved-body">
                {lockedOutcome?.solved
                  ? `Your official result is locked in${lockedOutcome.bestChainLength ? ` at a chain length of ${lockedOutcome.bestChainLength}` : ''} with a score of ${lockedOutcome.lockedScore ?? 0} - it won't change.`
                  : `Your official result for today is a loss, locked in with a score of ${lockedOutcome?.lockedScore ?? 0}. It won't change - and if this is today's puzzle, your streak was already reset when it happened.`}
              </p>
              <button type="button" onClick={resetPuzzle} className="btn btn-primary">
                Play for fun
              </button>
            </div>
          ) : solved ? (
            <div className="solved-panel">
              <h3 className="solved-title">
                <Trophy size={22} weight="fill" />
                Puzzle solved!
              </h3>
              <p className="solved-body">
                {practiceMode
                  ? `Nice - you connected all ${puzzle?.anchorPlayers.length ?? 0} given players again, but this was just a practice round. Today's official result is already locked in.`
                  : `You connected all ${puzzle?.anchorPlayers.length ?? 0} given players in one chain.`}
              </p>
              <p className="solved-score">
                {result?.chainLength && puzzle?.optimalLength ? (
                  result.chainLength === puzzle.optimalLength ? (
                    <>Congrats, you matched the optimal score of {puzzle.optimalLength}.</>
                  ) : (
                    <>Nice try, the optimal score was {puzzle.optimalLength}, and you finished with {result.chainLength}.</>
                  )
                ) : (
                  'Nice work finishing the chain.'
                )}
              </p>
              <button type="button" onClick={resetPuzzle} className="btn btn-primary">
                Play again
              </button>
              {result?.chainLength ? <p className="solved-length">Chain length score: {result.chainLength}</p> : null}
            </div>
          ) : failed ? (
            <div className="failed-panel">
              <h3 className="failed-title">
                <XCircle size={22} weight="fill" />
                Out of points
              </h3>
              <p className="failed-body">
                {practiceMode
                  ? "Your score hit 0 again on this practice round - it doesn't count. Today's official result stays as it was."
                  : "Your score hit 0, so the round is over. Today's result is now locked in as a loss, and your streak has been reset."}
              </p>
              <button type="button" onClick={resetPuzzle} className="btn btn-primary">
                Try again for fun
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              {practiceMode ? (
                <p className="hint practice-banner">
                  Practice round - today&apos;s official result is already locked in and won&apos;t change, no matter how this goes.
                </p>
              ) : null}
              {steps.map((step, index) => {
                const expectedType = index % 2 === 0 ? 'PLAYER' : 'CLUB';
                // The first step must be one of the given anchor players; every
                // later player step can be any real connecting player, not just
                // an anchor - the chain is free to detour through others.
                const entries = expectedType === 'PLAYER'
                  ? (index === 0 ? anchorPlayersSorted : sortedPlayers)
                  : sortedClubs;
                const rawQuery = stepSearchValues[index] ?? '';
                const query = rawQuery.toLowerCase();
                const usedEntryKeys = getUsedEntryKeys(steps, stepValidationStates, {
                  excludeIndex: index,
                });
                const visibleEntries = getVisibleCatalogEntries(entries, rawQuery, usedEntryKeys, expectedType);
                const selectedLabel = getDisplayLabel(step);
                const validationState = stepValidationStates[index];
                const rowStateClass = validationState ? ` step-row--${validationState}` : '';
                const shakeClass = invalidStepIndex === index ? ' step-row--shake' : '';

                // Once the preceding player step has validated, narrow this club row to a
                // dropdown of just that player's real clubs instead of a free-text search over
                // every club - falls back to the free-text UI below while that fetch is still in
                // flight, if it failed, or (a genuine data gap) the player has zero linked clubs.
                const precedingPlayerId = expectedType === 'CLUB' ? steps[index - 1]?.id ?? null : null;
                const playerClubOptions = precedingPlayerId !== null ? playerClubsCache[precedingPlayerId] : undefined;
                const showClubDropdown = expectedType === 'CLUB' && !!playerClubOptions && playerClubOptions.length > 0;

                return (
                  <div className="step-block" key={`${expectedType}-${index}`}>
                    <div key={`shake-${shakeKey}-${index}`} className={`step-row${rowStateClass}${shakeClass}`}>
                      <div className="step-type-badge">{expectedType === 'PLAYER' ? 'Player' : 'Club'}</div>

                      <div className="step-input-wrap">
                        {showClubDropdown ? (
                          <select
                            value={step.id ?? ''}
                            disabled={validationState === 'valid'}
                            onChange={(event) => {
                              const clubId = Number(event.target.value);
                              const entry = playerClubOptions!.find((club) => club.id === clubId);
                              if (entry) {
                                selectSuggestion(index, entry, 'CLUB');
                              }
                            }}
                            className={`step-input step-select${selectedLabel !== 'Select an option' ? ' step-input--filled' : ''}`}
                          >
                            <option value="" disabled>
                              Select a club...
                            </option>
                            {[...playerClubOptions!].sort(sortMatches).map((club) => {
                              const isRepeatedLink = usedEntryKeys.has(nodeKey('CLUB', club.id));
                              return (
                                <option key={club.id} value={club.id}>
                                  {club.name}
                                  {isRepeatedLink ? ' (already used)' : ''}
                                </option>
                              );
                            })}
                          </select>
                        ) : (
                        <>
                        <input
                          value={rawQuery}
                          disabled={validationState === 'valid'}
                          onChange={(event) => {
                            const nextValue = event.target.value;
                            setStepSearchValues((current) => ({ ...current, [index]: nextValue }));
                            setStepShowSuggestions((current) => ({ ...current, [index]: true }));
                            setHighlightedSuggestionIndex((current) => ({ ...current, [index]: 0 }));
                            setStepValidationStates((current) => ({ ...current, [index]: null }));
                            const match = entries.find((entry) => foldAccents(entry.name.toLowerCase()) === foldAccents(nextValue.trim().toLowerCase()));
                            if (match) {
                              updateStep(index, { id: match.id, type: expectedType });
                            }
                          }}
                          onKeyDown={(event) => {
                            if (!stepShowSuggestions[index] || visibleEntries.length === 0) {
                              return;
                            }

                            const currentIndex = highlightedSuggestionIndex[index] ?? 0;

                            if (event.key === 'ArrowDown') {
                              event.preventDefault();
                              setHighlightedSuggestionIndex((current) => ({ ...current, [index]: (currentIndex + 1) % visibleEntries.length }));
                            } else if (event.key === 'ArrowUp') {
                              event.preventDefault();
                              setHighlightedSuggestionIndex((current) => ({ ...current, [index]: (currentIndex - 1 + visibleEntries.length) % visibleEntries.length }));
                            } else if (event.key === 'Enter') {
                              event.preventDefault();
                              const entry = visibleEntries[currentIndex];
                              if (entry) {
                                selectSuggestion(index, entry, expectedType);
                              }
                            }
                          }}
                          onFocus={() => setStepShowSuggestions((current) => ({ ...current, [index]: true }))}
                          onBlur={() => window.setTimeout(() => setStepShowSuggestions((current) => ({ ...current, [index]: false })), 120)}
                          placeholder={expectedType === 'PLAYER' ? 'Type a player name' : 'Type a club name'}
                          className={`step-input${selectedLabel !== 'Select an option' ? ' step-input--filled' : ''}`}
                        />

                        {stepShowSuggestions[index] && query && visibleEntries.length > 0 ? (
                          <div className="suggestions">
                            {visibleEntries.slice(0, 6).map((entry, suggestionIndex) => {
                              const isHighlighted = (highlightedSuggestionIndex[index] ?? 0) === suggestionIndex;
                              const isRepeatedLink = entry.isAlreadyUsed;
                              return (
                                <button
                                  key={entry.id}
                                  type="button"
                                  onClick={() => selectSuggestion(index, entry, expectedType)}
                                  className={`suggestion-item${isRepeatedLink ? ' suggestion-item--used' : ''}${isHighlighted ? ' suggestion-item--highlighted' : ''}`}
                                >
                                  <span>{entry.name}</span>
                                  {isRepeatedLink ? <span className="suggestion-tag">already used</span> : null}
                                </button>
                              );
                            })}
                          </div>
                        ) : null}
                        </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              <div className="submit-row">
                <button type="submit" disabled={loading} className="btn btn-primary">
                  {loading ? 'Validating...' : 'Submit link'}
                </button>
                <span className="hint">Once a link is submitted, it stays locked in. Think carefully before you commit.</span>
              </div>
            </form>
          )}

          {error ? <p className="error-text">{error}</p> : null}
        </section>

        {lockedOutcome?.outcomeLocked && availableDates && selectedDate === availableDates.today ? (
          <DailyLeaderboardPreview date={selectedDate} />
        ) : null}
      </div>

      <style jsx global>{`
        :root {
          color-scheme: dark;
          --font-display: var(--font-display), 'Segoe UI', sans-serif;
          --font-mono: var(--font-mono), 'SFMono-Regular', monospace;

          --bg: #0b120d;
          --surface: #121b15;
          --surface-muted: #17221a;
          --border: #223026;
          --ink: #ecf3ee;
          --ink-muted: #9dafa3;
          --accent: #34c77b;
          --accent-strong: #57da95;
          --accent-soft: rgba(52, 199, 123, 0.14);
          --accent-soft-border: rgba(52, 199, 123, 0.32);

          --valid: #34c77b;
          --valid-bg: rgba(52, 199, 123, 0.14);
          --invalid: #f0645c;
          --invalid-bg: rgba(240, 100, 92, 0.14);
          --repeat: #e7b23a;
          --repeat-bg: rgba(231, 178, 58, 0.14);

          --gold: #e7b23a;
          --gold-soft: rgba(231, 178, 58, 0.16);

          --header-bg: #11201a;
          --header-fg: #f5f7f1;
          --header-ring: rgba(245, 247, 241, 0.08);

          --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.4);
          --shadow-md: 0 18px 36px rgba(0, 0, 0, 0.5);
          --radius-panel: 20px;
          --radius-input: 12px;
          --radius-pill: 999px;
        }

        /* Dark is the default (see above). Light is opt-in via the toggle. */
        :root[data-theme='light'] {
          color-scheme: light;
          --bg: #f5f7f1;
          --surface: #ffffff;
          --surface-muted: #eef2e9;
          --border: #dde4d6;
          --ink: #11201a;
          --ink-muted: #5b6b60;
          --accent: #1f7a4c;
          --accent-strong: #155c39;
          --accent-soft: rgba(31, 122, 76, 0.1);
          --accent-soft-border: rgba(31, 122, 76, 0.28);

          --valid: #1f9d55;
          --valid-bg: #e8f6ec;
          --invalid: #c7433b;
          --invalid-bg: #fcecea;
          --repeat: #b5790e;
          --repeat-bg: #fbf0db;

          --gold: #b1860f;
          --gold-soft: rgba(199, 154, 42, 0.14);

          --shadow-sm: 0 1px 2px rgba(17, 32, 26, 0.07);
          --shadow-md: 0 14px 30px rgba(17, 32, 26, 0.1);
        }

        /* Explicit toggle override: matches the default, kept for clarity when data-theme='dark' is set. */
        :root[data-theme='dark'] {
          --bg: #0b120d;
          --surface: #121b15;
          --surface-muted: #17221a;
          --border: #223026;
          --ink: #ecf3ee;
          --ink-muted: #9dafa3;
          --accent: #34c77b;
          --accent-strong: #57da95;
          --accent-soft: rgba(52, 199, 123, 0.14);
          --accent-soft-border: rgba(52, 199, 123, 0.32);

          --valid: #34c77b;
          --valid-bg: rgba(52, 199, 123, 0.14);
          --invalid: #f0645c;
          --invalid-bg: rgba(240, 100, 92, 0.14);
          --repeat: #e7b23a;
          --repeat-bg: rgba(231, 178, 58, 0.14);

          --gold: #e7b23a;
          --gold-soft: rgba(231, 178, 58, 0.16);

          --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.4);
          --shadow-md: 0 18px 36px rgba(0, 0, 0, 0.5);
        }

        * {
          box-sizing: border-box;
        }

        body {
          margin: 0;
          font-family: var(--font-display);
          background: var(--bg);
          color: var(--ink);
        }

        button,
        input {
          font-family: inherit;
        }

        :focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 2px;
        }

        .page {
          min-height: 100dvh;
          background: var(--bg);
          color: var(--ink);
        }

        .header {
          position: relative;
          background: var(--header-bg);
          color: var(--header-fg);
          padding: 18px 24px;
          border-bottom: 3px solid var(--accent);
          overflow: hidden;
        }

        .header::before {
          content: '';
          position: absolute;
          top: 50%;
          right: -60px;
          width: 220px;
          height: 220px;
          border: 2px solid var(--header-ring);
          border-radius: 50%;
          transform: translateY(-50%);
          pointer-events: none;
        }

        .header-inner {
          position: relative;
          max-width: 1100px;
          margin: 0 auto;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 16px;
          flex-wrap: wrap;
        }

        .brand {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .brand-mark {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 44px;
          height: 44px;
          border-radius: var(--radius-pill);
          background: var(--accent-soft);
          border: 1px solid rgba(52, 199, 123, 0.3);
          color: var(--accent-strong);
          flex-shrink: 0;
        }

        .brand-title {
          margin: 0;
          font-size: 26px;
          font-weight: 700;
          letter-spacing: -0.02em;
        }

        .brand-subtitle {
          margin: 2px 0 0;
          font-size: 13px;
          opacity: 0.75;
        }

        .brand-badge {
          background: var(--accent);
          color: #ffffff;
          padding: 8px 14px;
          border-radius: var(--radius-pill);
          font-weight: 700;
          font-size: 12px;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }

        .header-actions {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .duel-button {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 8px 14px;
          border-radius: var(--radius-pill);
          border: 1px solid var(--header-ring);
          background: transparent;
          color: var(--header-fg);
          font-weight: 700;
          font-size: 12px;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          text-decoration: none;
          cursor: pointer;
          transition: background 0.15s ease, transform 0.15s ease;
        }

        .duel-button:hover {
          background: rgba(245, 247, 241, 0.1);
        }

        .duel-button:active {
          transform: scale(0.96);
        }

        .theme-toggle {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 36px;
          height: 36px;
          border-radius: var(--radius-pill);
          border: 1px solid var(--header-ring);
          background: transparent;
          color: var(--header-fg);
          cursor: pointer;
          transition: background 0.15s ease, transform 0.15s ease;
        }

        .theme-toggle:hover {
          background: rgba(245, 247, 241, 0.1);
        }

        .theme-toggle:active {
          transform: scale(0.94);
        }

        .container {
          max-width: 1100px;
          margin: 0 auto;
          padding: 24px;
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .panel {
          background: var(--surface);
          border-radius: var(--radius-panel);
          padding: 24px;
          box-shadow: var(--shadow-md);
          border: 1px solid var(--border);
        }

        .panel-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 16px;
          flex-wrap: wrap;
          margin-bottom: 14px;
        }

        .panel-title {
          margin: 0 0 12px;
          font-size: 19px;
          font-weight: 700;
          color: var(--ink);
        }

        .panel-header .panel-title {
          margin-bottom: 0;
        }

        .step-count {
          background: var(--accent-soft);
          color: var(--accent-strong);
          padding: 6px 12px;
          border-radius: var(--radius-pill);
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }

        .required-sequence {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 16px;
        }

        .req-chip {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          border-radius: var(--radius-pill);
          background: var(--surface-muted);
          border: 1px solid var(--border);
          font-weight: 600;
          font-size: 14px;
        }

        .req-chip--visited {
          background: var(--accent-soft);
          border-color: var(--accent-soft-border);
          color: var(--accent-strong);
        }

        .req-chip-icon {
          color: var(--accent);
          flex-shrink: 0;
        }

        .field-row {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }

        .field-label {
          font-weight: 700;
          color: var(--ink);
          font-size: 14px;
        }

        .date-input {
          padding: 8px 10px;
          border-radius: var(--radius-input);
          border: 1px solid var(--border);
          background: var(--surface);
          color: var(--ink);
        }

        .hint {
          color: var(--ink-muted);
          font-size: 13px;
        }

        .legend {
          display: flex;
          gap: 14px;
          flex-wrap: wrap;
          margin-bottom: 14px;
          font-size: 13px;
        }

        .legend-item {
          display: flex;
          align-items: center;
          gap: 6px;
          font-weight: 600;
        }

        .legend-item--valid {
          color: var(--valid);
        }

        .legend-item--invalid {
          color: var(--invalid);
        }

        .legend-item--repeat {
          color: var(--repeat);
        }

        .chain-trail {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 4px;
          margin-bottom: 14px;
        }

        .chain-trail-item {
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .chain-connector {
          width: 14px;
          height: 2px;
          background: var(--border);
          border-radius: 1px;
          flex-shrink: 0;
        }

        .chain-link {
          padding: 7px 13px;
          border-radius: var(--radius-pill);
          font-weight: 700;
          font-size: 13px;
          white-space: nowrap;
        }

        .chain-link--player {
          background: var(--ink);
          color: var(--surface);
        }

        .chain-link--club {
          background: transparent;
          color: var(--accent-strong);
          border: 1.5px solid var(--accent-soft-border);
        }

        .callout {
          margin-bottom: 12px;
          padding: 10px 14px;
          border-radius: 12px;
          background: var(--repeat-bg);
          border: 1px solid rgba(181, 121, 14, 0.25);
        }

        .callout-title {
          font-weight: 700;
          color: var(--repeat);
          margin-bottom: 6px;
          font-size: 13px;
        }

        .callout-chips {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .callout-chip {
          padding: 6px 10px;
          border-radius: var(--radius-pill);
          background: var(--surface);
          color: var(--ink);
          font-weight: 600;
          font-size: 13px;
          border: 1px solid var(--border);
        }

        .callout-chip-hint {
          color: var(--ink-muted);
          font-weight: 500;
        }

        .anchor-reveal-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .anchor-reveal-row {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }

        .btn-hint--small {
          padding: 5px 10px;
          font-size: 12px;
          gap: 4px;
        }

        .hint-row {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
          margin-bottom: 14px;
        }

        .hint-text {
          color: var(--ink-muted);
          font-size: 13px;
        }

        .btn-hint {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: var(--gold-soft);
          color: var(--gold);
        }

        .btn-hint:hover:not(:disabled) {
          background: var(--repeat-bg);
        }

        .helper-text {
          margin: 0 0 16px;
          color: var(--ink-muted);
          font-size: 13px;
        }

        .stat-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
          gap: 12px;
          margin-bottom: 18px;
        }

        .stat-card {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          padding: 12px 14px;
          border-radius: 14px;
          background: var(--surface-muted);
          border: 1px solid var(--border);
        }

        .stat-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 30px;
          height: 30px;
          border-radius: 10px;
          background: var(--accent-soft);
          color: var(--accent-strong);
          flex-shrink: 0;
        }

        .stat-label {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.07em;
          color: var(--ink-muted);
          font-weight: 700;
        }

        .stat-value {
          font-weight: 700;
          margin-top: 2px;
          color: var(--ink);
          font-size: 15px;
        }

        .stat-value--mono {
          font-family: var(--font-mono);
          font-size: 18px;
        }

        .stat-sub {
          font-size: 12px;
          color: var(--ink-muted);
          margin-top: 2px;
          font-family: var(--font-mono);
        }

        .solved-panel {
          padding: 20px;
          border-radius: 16px;
          background: var(--gold-soft);
          border: 1px solid rgba(199, 154, 42, 0.32);
          animation: rise 0.4s cubic-bezier(0.16, 1, 0.3, 1);
        }

        .solved-title {
          display: flex;
          align-items: center;
          gap: 10px;
          margin: 0 0 8px;
          color: var(--gold);
          font-size: 20px;
        }

        .solved-body {
          margin: 0 0 8px;
          color: var(--ink);
        }

        .solved-score {
          margin: 0 0 14px;
          color: var(--accent-strong);
          font-weight: 600;
        }

        .solved-length {
          margin: 12px 0 0;
          color: var(--accent-strong);
          font-weight: 700;
          font-family: var(--font-mono);
        }

        .failed-panel {
          padding: 20px;
          border-radius: 16px;
          background: var(--invalid-bg);
          border: 1px solid var(--invalid);
          animation: rise 0.4s cubic-bezier(0.16, 1, 0.3, 1);
        }

        .failed-title {
          display: flex;
          align-items: center;
          gap: 10px;
          margin: 0 0 8px;
          color: var(--invalid);
          font-size: 20px;
        }

        .failed-body {
          margin: 0 0 14px;
          color: var(--ink);
        }

        .practice-banner {
          margin-bottom: 12px;
          padding: 10px 12px;
          border-radius: 10px;
          background: var(--surface-muted);
          border: 1px solid var(--border);
        }

        .rules-details {
          margin-top: 14px;
          font-size: 13px;
          color: var(--ink-muted);
        }

        .rules-details summary {
          cursor: pointer;
          color: var(--ink);
          font-weight: 600;
        }

        .rules-list {
          margin: 8px 0 0;
          padding-left: 18px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .step-block {
          margin-bottom: 12px;
        }

        .step-row {
          display: flex;
          gap: 12px;
          align-items: center;
          flex-wrap: wrap;
          border: 1.5px solid transparent;
          border-radius: var(--radius-input);
          padding: 4px;
        }

        .step-row--valid {
          border-color: var(--valid);
          background: var(--valid-bg);
          padding: 10px;
        }

        .step-row--invalid {
          border-color: var(--invalid);
          background: var(--invalid-bg);
          padding: 10px;
        }

        .step-row--repeat {
          border-color: var(--repeat);
          background: var(--repeat-bg);
          padding: 10px;
        }

        .step-row--shake {
          animation: shake 0.35s linear 1;
        }

        .step-type-badge {
          min-width: 96px;
          padding: 8px 10px;
          border-radius: 10px;
          background: var(--surface-muted);
          font-weight: 700;
          color: var(--accent-strong);
          text-transform: uppercase;
          letter-spacing: 0.04em;
          font-size: 12px;
          text-align: center;
        }

        .step-input-wrap {
          flex: 1;
          min-width: 220px;
          position: relative;
        }

        .step-input {
          width: 100%;
          padding: 10px 12px;
          border-radius: var(--radius-input);
          border: 1px solid var(--border);
          background: var(--surface);
          color: var(--ink);
          font-weight: 500;
        }

        .step-input:disabled {
          opacity: 0.85;
        }

        .step-input--filled {
          font-weight: 700;
          background: var(--accent-soft);
        }

        .step-input::placeholder {
          color: var(--ink-muted);
        }

        .step-select {
          appearance: auto;
          cursor: pointer;
        }

        .step-select:disabled {
          opacity: 0.85;
          cursor: default;
        }

        .suggestions {
          position: absolute;
          top: calc(100% + 4px);
          left: 0;
          right: 0;
          z-index: 5;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-input);
          box-shadow: var(--shadow-md);
          overflow: hidden;
        }

        .suggestion-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
          width: 100%;
          text-align: left;
          padding: 9px 12px;
          border: none;
          background: var(--surface);
          color: var(--ink);
          cursor: pointer;
          font-size: 14px;
        }

        .suggestion-item:hover,
        .suggestion-item--highlighted {
          background: var(--surface-muted);
        }

        .suggestion-item--used {
          background: var(--repeat-bg);
          color: var(--repeat);
          font-weight: 600;
        }

        .suggestion-tag {
          font-size: 11px;
          color: var(--repeat);
        }

        .submit-row {
          margin-top: 12px;
          display: flex;
          gap: 12px;
          align-items: center;
          flex-wrap: wrap;
        }

        .btn {
          padding: 10px 20px;
          border-radius: var(--radius-pill);
          border: none;
          font-weight: 700;
          font-size: 14px;
          cursor: pointer;
          transition: transform 0.15s ease, opacity 0.15s ease;
        }

        .btn:active {
          transform: translateY(1px) scale(0.98);
        }

        .btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .btn-primary {
          background: var(--accent);
          color: #ffffff;
        }

        .btn-primary:hover:not(:disabled) {
          background: var(--accent-strong);
        }

        .error-text {
          color: var(--invalid);
          margin-top: 12px;
        }

        @keyframes shake {
          0%,
          100% {
            transform: translateX(0);
          }
          20% {
            transform: translateX(-6px);
          }
          40% {
            transform: translateX(6px);
          }
          60% {
            transform: translateX(-4px);
          }
          80% {
            transform: translateX(4px);
          }
        }

        @keyframes rise {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .step-row--shake,
          .solved-panel,
          .failed-panel,
          .btn,
          .theme-toggle {
            animation: none !important;
            transition: none !important;
          }
        }

        @media (max-width: 720px) {
          .stat-grid {
            grid-template-columns: repeat(2, 1fr);
          }
        }
      `}</style>

      <DisplayNameModal
        open={showNameModal}
        onDismiss={() => {
          window.sessionStorage.setItem(`fc_display_name_dismissed_${selectedDate}`, '1');
          setShowNameModal(false);
        }}
        onSubmit={async (name) => {
          const response = await apiFetch('/api/me/display-name', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ displayName: name }),
          });
          if (!response.ok) {
            throw new Error('Failed to save display name');
          }
          const data = (await response.json()) as { displayName: string };
          setServerStats((current) => (current ? { ...current, displayName: data.displayName } : current));
          setShowNameModal(false);
        }}
      />
    </main>
  );
}
