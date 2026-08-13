'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { CheckCircle, Flag, House, Moon, Sun, Trophy, XCircle } from '@phosphor-icons/react';

import { foldAccents, getVisibleCatalogEntries } from '../../puzzle-suggestions';
import { isTheme, THEME_STORAGE_KEY, type Theme } from '../../theme';

type CatalogEntry = { id: number; name: string };
type ChainNode = { id: number | null; type: 'PLAYER' | 'CLUB' };
type ChainNodeInput = { id: number; type: 'PLAYER' | 'CLUB' };

type MatchStatus = 'WAITING_FOR_OPPONENT' | 'READY_COUNTDOWN' | 'IN_PROGRESS' | 'FINISHED' | 'CANCELLED';

type MatchState = {
  matchId: number;
  inviteCode: string;
  status: MatchStatus;
  anchorPlayers: Array<{ id: number; name: string }>;
  startedAt: string | null;
  you: 'a' | 'b';
  opponentPresent: boolean;
  youReady: boolean;
  opponentReady: boolean;
  youFinishedAt: string | null;
  opponentFinishedAt: string | null;
  youChain: ChainNodeInput[] | null;
  opponentChain: ChainNodeInput[] | null;
  winner: 'you' | 'opponent' | null;
  opponentForfeited: boolean;
};

type SubmitResponse = { valid: boolean; solved: boolean; reason?: string };

function sortEntries(a: CatalogEntry, b: CatalogEntry) {
  return a.name.localeCompare(b.name);
}

function formatDuration(startedAt: string, finishedAt: string): string {
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  const seconds = Math.max(0, ms / 1000);
  return `${seconds.toFixed(1)}s`;
}

export default function SpeedRoundMatchPage() {
  const params = useParams<{ code: string }>();
  const inviteCode = (params.code ?? '').toUpperCase();

  const [theme, setTheme] = useState<Theme>('dark');
  const [catalog, setCatalog] = useState<{ players: CatalogEntry[]; clubs: CatalogEntry[] }>({ players: [], clubs: [] });
  // The invite code in the URL is what's shareable/unguessable - the numeric matchId used for
  // every other API call is resolved from it via /api/speed-round/join, which is idempotent
  // for a caller who's already a participant (including the creator's own page load). This is
  // what actually lets a second player join at all - polling never happens before this
  // resolves, since without it there's no matchId to poll.
  const [matchId, setMatchId] = useState<number | null>(null);
  const [matchState, setMatchState] = useState<MatchState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [readySubmitting, setReadySubmitting] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);
  const [showSummary, setShowSummary] = useState(false);

  const [steps, setSteps] = useState<ChainNode[]>([{ id: null, type: 'PLAYER' }]);
  const [stepSearchValues, setStepSearchValues] = useState<Record<number, string>>({});
  const [stepShowSuggestions, setStepShowSuggestions] = useState<Record<number, boolean>>({});
  const [highlightedSuggestionIndex, setHighlightedSuggestionIndex] = useState<Record<number, number>>({});
  const [stepValidationStates, setStepValidationStates] = useState<Record<number, 'valid' | 'invalid' | null>>({});
  const [invalidStepIndex, setInvalidStepIndex] = useState<number | null>(null);
  const [shakeKey, setShakeKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (isTheme(stored)) setTheme(stored);
  }, []);

  function toggleTheme() {
    setTheme((current) => {
      const next: Theme = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
      return next;
    });
  }

  useEffect(() => {
    fetch('/api/catalog')
      .then((res) => res.json())
      .then(setCatalog)
      .catch(() => undefined);
  }, []);

  // Resolves the URL's invite code to a matchId by joining - idempotent for a caller who's
  // already a participant, so this runs unconditionally on mount for both the creator and a
  // real second player. Nothing else (polling included) can start until this succeeds.
  useEffect(() => {
    if (!inviteCode) return;
    let cancelled = false;

    fetch('/api/speed-round/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inviteCode }),
    })
      .then(async (response) => {
        const data = (await response.json()) as { matchId: number } | { error: string };
        if (cancelled) return;
        if (!response.ok || 'error' in data) {
          setLoadError('error' in data ? data.error : 'Unable to join this race.');
          return;
        }
        setMatchId(data.matchId);
      })
      .catch(() => {
        if (!cancelled) setLoadError('Unable to join this race right now.');
      });

    return () => {
      cancelled = true;
    };
  }, [inviteCode]);

  // Polls at a fixed ~1.2s cadence for the whole page lifetime, including after FINISHED - a
  // losing player who's still racing (see the race UI below - it stays open until they finish
  // too) can still update opponentChain/opponentFinishedAt for the winner's summary view.
  useEffect(() => {
    if (matchId === null) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function tick() {
      try {
        const response = await fetch(`/api/speed-round/${matchId}/state`);
        if (response.ok) {
          const data = (await response.json()) as MatchState;
          if (!cancelled) {
            setMatchState(data);
            setLoadError(null);
          }
        } else if (!cancelled) {
          setLoadError('This race could not be found - the link may be wrong or the race may have expired.');
        }
      } catch {
        // Transient network error - just try again next tick.
      }
      if (!cancelled) {
        timer = setTimeout(tick, 1200);
      }
    }

    tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [matchId]);

  // A smoother, faster-ticking clock just for the countdown display - independent of the
  // ~1.2s state poll so the numbers don't visibly stutter.
  useEffect(() => {
    if (matchState?.status !== 'READY_COUNTDOWN' || !matchState.startedAt) return;
    const id = setInterval(() => setNow(Date.now()), 150);
    return () => clearInterval(id);
  }, [matchState?.status, matchState?.startedAt]);

  const countdownSeconds = useMemo(() => {
    if (!matchState?.startedAt) return null;
    return Math.max(0, Math.ceil((new Date(matchState.startedAt).getTime() - now) / 1000));
  }, [matchState?.startedAt, now]);

  const sortedPlayers = useMemo(() => [...catalog.players].sort(sortEntries), [catalog.players]);
  const sortedClubs = useMemo(() => [...catalog.clubs].sort(sortEntries), [catalog.clubs]);
  const catalogLookup = useMemo(
    () => ({
      players: new Map(sortedPlayers.map((entry) => [entry.id, entry.name] as const)),
      clubs: new Map(sortedClubs.map((entry) => [entry.id, entry.name] as const)),
    }),
    [sortedPlayers, sortedClubs],
  );

  const remainingAnchors = useMemo(() => {
    if (!matchState) return [];
    const visitedIds = steps
      .filter((step, index) => step.id !== null && step.type === 'PLAYER' && stepValidationStates[index] === 'valid')
      .map((step) => step.id as number);
    return matchState.anchorPlayers.filter((player) => !visitedIds.includes(player.id));
  }, [matchState, steps, stepValidationStates]);

  function getDisplayLabel(node: ChainNode) {
    if (node.id === null) return 'Select an option';
    const label = (node.type === 'PLAYER' ? catalogLookup.players : catalogLookup.clubs).get(node.id);
    return label ?? 'Select an option';
  }

  function appendNextStep() {
    setSteps((current) => {
      const nextIndex = current.length;
      const expectedType = nextIndex % 2 === 0 ? 'PLAYER' : 'CLUB';
      return [...current, { id: null, type: expectedType }];
    });
    setStepSearchValues((current) => ({ ...current, [steps.length]: '' }));
    setStepShowSuggestions((current) => ({ ...current, [steps.length]: false }));
    setInvalidStepIndex(null);
  }

  function updateStep(index: number, next: ChainNode) {
    setSteps((current) => current.map((node, i) => (i === index ? next : node)));
  }

  function selectSuggestion(index: number, entry: CatalogEntry, expectedType: 'PLAYER' | 'CLUB') {
    updateStep(index, { id: entry.id, type: expectedType });
    setStepSearchValues((current) => ({ ...current, [index]: entry.name }));
    setStepShowSuggestions((current) => ({ ...current, [index]: false }));
    setHighlightedSuggestionIndex((current) => ({ ...current, [index]: 0 }));
    setStepValidationStates((current) => ({ ...current, [index]: null }));
  }

  async function validateCurrentStep(index: number) {
    if (steps[index]?.id === null || matchId === null) return;

    const chainToValidate = steps.slice(0, index + 1).map((step) => ({ id: step.id as number, type: step.type }));

    setSubmitting(true);
    setSubmitError(null);
    try {
      const response = await fetch(`/api/speed-round/${matchId}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chain: chainToValidate }),
      });
      const data = (await response.json()) as SubmitResponse;

      setStepValidationStates((current) => ({ ...current, [index]: data.valid ? 'valid' : 'invalid' }));

      if (!data.valid) {
        setInvalidStepIndex(index);
        setShakeKey((value) => value + 1);
      } else {
        setInvalidStepIndex(null);
        if (!data.solved && index === steps.length - 1) {
          appendNextStep();
        }
      }

      // Solving is exactly when the match state (winner, your own finished time) changes -
      // refresh immediately rather than waiting up to ~1.2s for the next scheduled poll.
      if (data.solved) {
        const stateResponse = await fetch(`/api/speed-round/${matchId}/state`);
        if (stateResponse.ok) {
          setMatchState((await stateResponse.json()) as MatchState);
        }
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Unable to submit right now.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleFormSubmit(event: React.FormEvent) {
    event.preventDefault();
    const lastCompletedStepIndex = steps.reduce<number | null>((lastIndex, step, index) => (step.id !== null ? index : lastIndex), null);
    if (lastCompletedStepIndex === null) return;
    await validateCurrentStep(lastCompletedStepIndex);
  }

  async function handleReady() {
    if (matchId === null) return;
    setReadySubmitting(true);
    try {
      await fetch(`/api/speed-round/${matchId}/ready`, { method: 'POST' });
      const response = await fetch(`/api/speed-round/${matchId}/state`);
      if (response.ok) setMatchState((await response.json()) as MatchState);
    } finally {
      setReadySubmitting(false);
    }
  }

  async function handleCopyLink() {
    // The invite code, not the numeric matchId, is what's actually shareable - matchId is a
    // guessable sequential id and never appears in a link a player would send someone else.
    const url = `${window.location.origin}/speed/${inviteCode}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access denied - the code is still shown as visible text below.
    }
  }

  return (
    <main className="page">
      <header className="header">
        <div className="header-inner">
          <Link href="/" className="brand">
            <span className="brand-mark" aria-hidden="true">
              <Flag size={24} weight="duotone" />
            </span>
            <div>
              <h1 className="brand-title">Football Chain</h1>
              <p className="brand-subtitle">Speed Round {matchState?.inviteCode ? `#${matchState.inviteCode}` : ''}</p>
            </div>
          </Link>
          <div className="header-actions">
            <Link href="/" className="home-button" title="Back to the daily puzzle">
              <House size={16} weight="fill" />
              Daily puzzle
            </Link>
            <button type="button" onClick={toggleTheme} className="theme-toggle" aria-label="Toggle theme">
              {theme === 'dark' ? <Sun size={18} weight="fill" /> : <Moon size={18} weight="fill" />}
            </button>
          </div>
        </div>
      </header>

      <div className="container">
        {loadError ? <p className="error-text">{loadError}</p> : null}

        {loadError ? null : !matchState ? (
          <p className="hint">Loading race...</p>
        ) : (
          <>
            <div className="required-sequence">
              {[...matchState.anchorPlayers].sort(sortEntries).map((player) => {
                const visited = !remainingAnchors.some((remaining) => remaining.id === player.id);
                return (
                  <div key={player.id} className={`req-chip${visited ? ' req-chip--visited' : ''}`}>
                    {visited ? <CheckCircle size={14} weight="fill" /> : null}
                    <span>{player.name}</span>
                  </div>
                );
              })}
            </div>

            {matchState.status === 'WAITING_FOR_OPPONENT' ? (
              <section className="panel">
                <h2 className="panel-title">Waiting for an opponent</h2>
                <p className="hint">Send this link to whoever you want to race:</p>
                <div className="share-row">
                  <code className="share-code">{typeof window !== 'undefined' ? `${window.location.origin}/speed/${inviteCode}` : matchState.inviteCode}</code>
                  <button type="button" onClick={handleCopyLink} className="btn btn-primary">
                    {copied ? 'Copied!' : 'Copy link'}
                  </button>
                </div>
                <p className="hint">Or share just the code: <strong>{matchState.inviteCode}</strong></p>
              </section>
            ) : null}

            {matchState.status === 'READY_COUNTDOWN' ? (
              <section className="panel panel-center">
                {!matchState.startedAt ? (
                  <>
                    <h2 className="panel-title">Your opponent is here!</h2>
                    <p className="hint">
                      {matchState.youReady
                        ? "Waiting for them to ready up..."
                        : "Ready up when you're set - the race starts 5 seconds after you're both ready."}
                    </p>
                    {!matchState.youReady ? (
                      <button type="button" onClick={handleReady} disabled={readySubmitting} className="btn btn-primary">
                        {readySubmitting ? 'Getting ready...' : "I'm ready"}
                      </button>
                    ) : null}
                  </>
                ) : (
                  <>
                    <h2 className="panel-title">Get ready...</h2>
                    <div className="countdown-number">{countdownSeconds && countdownSeconds > 0 ? countdownSeconds : 'GO!'}</div>
                  </>
                )}
              </section>
            ) : null}

            {(matchState.status === 'IN_PROGRESS' || (matchState.status === 'FINISHED' && !matchState.youFinishedAt)) ? (
              <section className="panel">
                <div className="panel-header">
                  <h2 className="panel-title">Build your chain</h2>
                  <span className="opponent-status">
                    {matchState.opponentFinishedAt
                      ? 'Opponent has finished'
                      : matchState.opponentPresent
                        ? 'Opponent is still racing'
                        : ''}
                  </span>
                </div>

                {matchState.status === 'FINISHED' ? (
                  <p className="hint practice-banner">
                    {matchState.winner === 'you' ? "You won!" : 'Your opponent already finished'} - finish your own chain to
                    see your time in the summary.
                  </p>
                ) : null}

                <form onSubmit={handleFormSubmit}>
                  {steps.map((step, index) => {
                    const expectedType = index % 2 === 0 ? 'PLAYER' : 'CLUB';
                    const entries = expectedType === 'PLAYER' ? sortedPlayers : sortedClubs;
                    const rawQuery = stepSearchValues[index] ?? '';
                    const query = rawQuery.toLowerCase();
                    const visibleEntries = getVisibleCatalogEntries(entries, rawQuery, [], expectedType);
                    const selectedLabel = getDisplayLabel(step);
                    const validationState = stepValidationStates[index];
                    const rowStateClass = validationState ? ` step-row--${validationState}` : '';
                    const shakeClass = invalidStepIndex === index ? ' step-row--shake' : '';

                    return (
                      <div className="step-block" key={`${expectedType}-${index}`}>
                        <div key={`shake-${shakeKey}-${index}`} className={`step-row${rowStateClass}${shakeClass}`}>
                          <div className="step-type-badge">{expectedType === 'PLAYER' ? 'Player' : 'Club'}</div>
                          <div className="step-input-wrap">
                            <input
                              value={rawQuery}
                              disabled={validationState === 'valid'}
                              onChange={(event) => {
                                const nextValue = event.target.value;
                                setStepSearchValues((current) => ({ ...current, [index]: nextValue }));
                                setStepShowSuggestions((current) => ({ ...current, [index]: true }));
                                setHighlightedSuggestionIndex((current) => ({ ...current, [index]: 0 }));
                                setStepValidationStates((current) => ({ ...current, [index]: null }));
                                const match = entries.find(
                                  (entry) => foldAccents(entry.name.toLowerCase()) === foldAccents(nextValue.trim().toLowerCase()),
                                );
                                if (match) updateStep(index, { id: match.id, type: expectedType });
                              }}
                              onKeyDown={(event) => {
                                if (!stepShowSuggestions[index] || visibleEntries.length === 0) return;
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
                                  if (entry) selectSuggestion(index, entry, expectedType);
                                }
                              }}
                              onFocus={() => setStepShowSuggestions((current) => ({ ...current, [index]: true }))}
                              onBlur={() => window.setTimeout(() => setStepShowSuggestions((current) => ({ ...current, [index]: false })), 120)}
                              placeholder={expectedType === 'PLAYER' ? 'Type a player name' : 'Type a club name'}
                              className={`step-input${selectedLabel !== 'Select an option' ? ' step-input--filled' : ''}`}
                            />
                            {stepShowSuggestions[index] && query && visibleEntries.length > 0 ? (
                              <div className="suggestions">
                                {visibleEntries.slice(0, 6).map((entry, suggestionIndex) => (
                                  <button
                                    key={entry.id}
                                    type="button"
                                    onClick={() => selectSuggestion(index, entry, expectedType)}
                                    className={`suggestion-item${(highlightedSuggestionIndex[index] ?? 0) === suggestionIndex ? ' suggestion-item--highlighted' : ''}`}
                                  >
                                    {entry.name}
                                  </button>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  <div className="submit-row">
                    <button type="submit" disabled={submitting} className="btn btn-primary">
                      {submitting ? 'Checking...' : 'Submit link'}
                    </button>
                    <span className="hint">Repeats are fine here - just link all 3 as fast as you can.</span>
                  </div>
                </form>

                {submitError ? <p className="error-text">{submitError}</p> : null}
              </section>
            ) : null}

            {matchState.status === 'FINISHED' ? (
              <section className={`panel result-panel${matchState.winner === 'you' ? ' result-panel--win' : ''}`}>
                <h2 className="result-title">
                  {matchState.winner === 'you' ? <Trophy size={26} weight="fill" /> : <XCircle size={26} weight="fill" />}
                  {matchState.winner === 'you' ? 'You won!' : 'You lost this one'}
                </h2>
                <p className="hint">
                  {matchState.opponentForfeited
                    ? 'Your opponent went quiet mid-race, so you win by default.'
                    : matchState.winner === 'you'
                      ? matchState.youFinishedAt && matchState.startedAt
                        ? `You linked all 3 anchors in ${formatDuration(matchState.startedAt, matchState.youFinishedAt)}.`
                        : 'You linked all 3 anchors first.'
                      : matchState.opponentFinishedAt && matchState.startedAt
                        ? `Your opponent linked all 3 anchors in ${formatDuration(matchState.startedAt, matchState.opponentFinishedAt)}.`
                        : 'Your opponent linked all 3 anchors first.'}
                </p>

                {!showSummary ? (
                  <button type="button" onClick={() => setShowSummary(true)} className="btn btn-primary">
                    See full comparison
                  </button>
                ) : (
                  <div className="summary-grid">
                    <SummaryColumn
                      title="You"
                      chain={matchState.youChain}
                      finishedAt={matchState.youFinishedAt}
                      startedAt={matchState.startedAt}
                      won={matchState.winner === 'you'}
                      catalogLookup={catalogLookup}
                    />
                    <SummaryColumn
                      title="Opponent"
                      chain={matchState.opponentChain}
                      finishedAt={matchState.opponentFinishedAt}
                      startedAt={matchState.startedAt}
                      won={matchState.winner === 'opponent'}
                      forfeited={matchState.opponentForfeited}
                      catalogLookup={catalogLookup}
                    />
                  </div>
                )}
              </section>
            ) : null}
          </>
        )}
      </div>

      <style jsx global>{`
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
        }

        .header-inner {
          max-width: 720px;
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
          text-decoration: none;
          color: inherit;
        }

        .header-actions {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .home-button {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 8px 14px;
          border-radius: var(--radius-pill);
          border: 1px solid rgba(245, 247, 241, 0.2);
          background: transparent;
          color: var(--header-fg);
          font-weight: 700;
          font-size: 12px;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          text-decoration: none;
          cursor: pointer;
        }

        .home-button:hover {
          background: rgba(245, 247, 241, 0.1);
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
          font-size: 22px;
          font-weight: 700;
          letter-spacing: -0.02em;
        }

        .brand-subtitle {
          margin: 2px 0 0;
          font-size: 13px;
          opacity: 0.8;
          font-family: var(--font-mono);
        }

        .theme-toggle {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 36px;
          height: 36px;
          border-radius: var(--radius-pill);
          border: 1px solid rgba(245, 247, 241, 0.2);
          background: transparent;
          color: var(--header-fg);
          cursor: pointer;
        }

        .container {
          max-width: 720px;
          margin: 0 auto;
          padding: 24px 20px 60px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .hint {
          margin: 0;
          font-size: 13px;
          color: var(--ink-muted);
          line-height: 1.5;
        }

        .practice-banner {
          margin-bottom: 12px;
          padding: 10px 12px;
          border-radius: 10px;
          background: var(--surface-muted);
          border: 1px solid var(--border);
        }

        .error-text {
          color: var(--invalid);
          font-size: 14px;
        }

        .required-sequence {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .req-chip {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 8px 14px;
          border-radius: var(--radius-pill);
          border: 1.5px solid var(--border);
          background: var(--surface);
          font-size: 13px;
          font-weight: 600;
        }

        .req-chip--visited {
          border-color: var(--valid);
          background: var(--valid-bg);
          color: var(--valid);
        }

        .panel {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-panel);
          padding: 24px;
          box-shadow: var(--shadow-sm);
        }

        .panel-center {
          text-align: center;
        }

        .panel-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 12px;
        }

        .panel-title {
          margin: 0 0 6px;
          font-size: 18px;
          font-weight: 700;
        }

        .opponent-status {
          font-size: 12px;
          color: var(--ink-muted);
          font-weight: 600;
        }

        .share-row {
          display: flex;
          gap: 10px;
          align-items: center;
          flex-wrap: wrap;
          margin-bottom: 8px;
        }

        .share-code {
          flex: 1;
          min-width: 200px;
          padding: 10px 14px;
          border-radius: var(--radius-input);
          background: var(--surface-muted);
          border: 1.5px solid var(--border);
          font-family: var(--font-mono);
          font-size: 13px;
          overflow-x: auto;
          white-space: nowrap;
        }

        .countdown-number {
          font-size: 72px;
          font-weight: 800;
          font-family: var(--font-mono);
          color: var(--accent);
          margin: 12px 0;
        }

        .btn {
          border: none;
          border-radius: var(--radius-input);
          padding: 12px 20px;
          font-weight: 700;
          font-size: 14px;
          cursor: pointer;
        }

        .btn-primary {
          background: var(--accent);
          color: #08130d;
        }

        .btn-primary:disabled {
          opacity: 0.6;
          cursor: default;
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

        .step-row--shake {
          animation: shr 0.4s ease;
        }

        @keyframes shr {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-6px); }
          75% { transform: translateX(6px); }
        }

        .step-type-badge {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--ink-muted);
          width: 56px;
          flex-shrink: 0;
        }

        .step-input-wrap {
          position: relative;
          flex: 1;
          min-width: 200px;
        }

        .step-input {
          width: 100%;
          padding: 10px 14px;
          border-radius: var(--radius-input);
          border: 1.5px solid var(--border);
          background: var(--surface-muted);
          color: var(--ink);
          font-size: 15px;
        }

        .step-input:disabled {
          opacity: 0.85;
        }

        .suggestions {
          position: absolute;
          top: calc(100% + 4px);
          left: 0;
          right: 0;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-input);
          box-shadow: var(--shadow-md);
          z-index: 10;
          overflow: hidden;
        }

        .suggestion-item {
          display: block;
          width: 100%;
          text-align: left;
          padding: 10px 14px;
          border: none;
          background: transparent;
          color: var(--ink);
          cursor: pointer;
          font-size: 14px;
        }

        .suggestion-item--highlighted {
          background: var(--accent-soft);
        }

        .submit-row {
          display: flex;
          align-items: center;
          gap: 14px;
          flex-wrap: wrap;
          margin-top: 8px;
        }

        .result-panel {
          background: var(--surface);
        }

        .result-panel--win {
          background: var(--gold-soft);
          border-color: rgba(199, 154, 42, 0.32);
        }

        .result-title {
          display: flex;
          align-items: center;
          gap: 10px;
          margin: 0 0 8px;
          font-size: 22px;
        }

        .result-panel--win .result-title {
          color: var(--gold);
        }

        .summary-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 16px;
          margin-top: 16px;
        }

        .summary-column {
          border: 1.5px solid var(--border);
          border-radius: var(--radius-input);
          padding: 16px;
          background: var(--surface-muted);
        }

        .summary-column--win {
          border-color: var(--gold);
        }

        .summary-column-title {
          display: flex;
          align-items: center;
          gap: 6px;
          margin: 0 0 6px;
          font-size: 15px;
        }

        .summary-time {
          margin: 0 0 10px;
          font-family: var(--font-mono);
          font-weight: 700;
          color: var(--accent-strong);
        }

        .summary-chain {
          margin: 0;
          padding-left: 18px;
          font-size: 13px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
      `}</style>
    </main>
  );
}

function SummaryColumn({
  title,
  chain,
  finishedAt,
  startedAt,
  won,
  forfeited,
  catalogLookup,
}: {
  title: string;
  chain: ChainNodeInput[] | null;
  finishedAt: string | null;
  startedAt: string | null;
  won: boolean;
  forfeited?: boolean;
  catalogLookup: { players: Map<number, string>; clubs: Map<number, string> };
}) {
  return (
    <div className={`summary-column${won ? ' summary-column--win' : ''}`}>
      <h3 className="summary-column-title">
        {won ? <Trophy size={18} weight="fill" /> : null}
        {title}
      </h3>
      <p className="summary-time">
        {forfeited ? 'Forfeited' : finishedAt && startedAt ? formatDuration(startedAt, finishedAt) : 'Did not finish'}
      </p>
      {chain && chain.length > 0 ? (
        <ol className="summary-chain">
          {chain.map((node, index) => (
            <li key={`${node.type}-${node.id}-${index}`}>
              {(node.type === 'PLAYER' ? catalogLookup.players : catalogLookup.clubs).get(node.id) ?? `${node.type} ${node.id}`}
            </li>
          ))}
        </ol>
      ) : (
        <p className="hint">No chain recorded.</p>
      )}
    </div>
  );
}

