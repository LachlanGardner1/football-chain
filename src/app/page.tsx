'use client';

import { useEffect, useMemo, useState } from 'react';

type Puzzle = {
  puzzleId: number;
  date: string;
  startPlayer: { id: number; name: string };
  targetPlayer: { id: number; name: string };
};

type CatalogEntry = { id: number; name: string };

type ChainNode = { id: number | null; type: 'PLAYER' | 'CLUB' };

type ValidationResponse = {
  valid: boolean;
  solved: boolean;
  reason?: string;
  chainLength?: number;
};

function sortMatches(a: CatalogEntry, b: CatalogEntry) {
  return a.name.localeCompare(b.name);
}

export default function HomePage() {
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [catalog, setCatalog] = useState<{ players: CatalogEntry[]; clubs: CatalogEntry[] }>({ players: [], clubs: [] });
  const [steps, setSteps] = useState<ChainNode[]>([{ id: null, type: 'CLUB' }]);
  const [stepSearchValues, setStepSearchValues] = useState<Record<number, string>>({});
  const [stepShowSuggestions, setStepShowSuggestions] = useState<Record<number, boolean>>({});
  const [result, setResult] = useState<ValidationResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalidStepIndex, setInvalidStepIndex] = useState<number | null>(null);
  const [shakeKey, setShakeKey] = useState(0);

  const sortedPlayers = useMemo(() => [...catalog.players].sort(sortMatches), [catalog.players]);
  const sortedClubs = useMemo(() => [...catalog.clubs].sort(sortMatches), [catalog.clubs]);
  const catalogLookup = useMemo(
    () => ({
      players: new Map(sortedPlayers.map((entry) => [entry.id, entry.name] as const)),
      clubs: new Map(sortedClubs.map((entry) => [entry.id, entry.name] as const)),
    }),
    [sortedPlayers, sortedClubs],
  );

  useEffect(() => {
    Promise.all([fetch('/api/daily').then((res) => res.json()), fetch('/api/catalog').then((res) => res.json())])
      .then(([puzzleData, catalogData]) => {
        if (puzzleData.error) {
          setError(puzzleData.error);
          return;
        }
        setPuzzle(puzzleData);
        setCatalog(catalogData);
        setSteps([{ id: null, type: 'CLUB' }]);
        setStepSearchValues({});
        setStepShowSuggestions({});
      })
      .catch(() => setError('Unable to load puzzle data.'));
  }, []);

  const summary = useMemo(() => {
    if (!puzzle) return 'Loading today\'s puzzle...';
    return `${puzzle.startPlayer.name} → ${puzzle.targetPlayer.name}`;
  }, [puzzle]);

  function appendNextStep() {
    setSteps((current) => {
      const nextIndex = current.length;
      const expectedType = nextIndex % 2 === 0 ? 'CLUB' : 'PLAYER';
      return [...current, { id: null, type: expectedType }];
    });
    setStepSearchValues((current) => ({ ...current, [steps.length]: '' }));
    setStepShowSuggestions((current) => ({ ...current, [steps.length]: false }));
    setInvalidStepIndex(null);
  }

  function updateStep(index: number, next: ChainNode) {
    setSteps((current) => current.map((node, nodeIndex) => (nodeIndex === index ? next : node)));
  }

  async function validateCurrentStep(index: number) {
    if (!puzzle || steps[index]?.id === null) return;

    const chainToValidate = [{ id: puzzle.startPlayer.id, type: 'PLAYER' as const }, ...steps.slice(0, index + 1).map((step) => ({ id: step.id as number, type: step.type }))];

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch('/api/validate-chain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startPlayerId: puzzle.startPlayer.id,
          targetPlayerId: puzzle.targetPlayer.id,
          chain: chainToValidate,
        }),
      });

      const data = (await response.json()) as ValidationResponse;
      setResult(data);

      if (!data.valid) {
        setInvalidStepIndex(index);
        setShakeKey((value) => value + 1);
      } else {
        setInvalidStepIndex(null);
        if (data.solved) {
          const goalIndex = steps.length;
          setSteps((current) => [...current, { id: puzzle.targetPlayer.id, type: 'PLAYER' }]);
          setStepSearchValues((current) => ({ ...current, [goalIndex]: puzzle.targetPlayer.name }));
          setStepShowSuggestions((current) => ({ ...current, [goalIndex]: false }));
        } else if (index === steps.length - 1) {
          appendNextStep();
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to validate link.');
    } finally {
      setLoading(false);
    }
  }

  function removeStep(index: number) {
    const nextSteps = steps.filter((_, nodeIndex) => nodeIndex !== index);
    setSteps(nextSteps);
    setStepSearchValues((current) => {
      const next = { ...current };
      delete next[index];
      return next;
    });
    setStepShowSuggestions((current) => {
      const next = { ...current };
      delete next[index];
      return next;
    });
    setInvalidStepIndex(null);

    const remainingSteps = nextSteps.filter((step) => step.id !== null);
    if (!puzzle || remainingSteps.length === 0) {
      setResult(null);
      return;
    }

    const revalidatedChain = [{ id: puzzle.startPlayer.id, type: 'PLAYER' as const }, ...remainingSteps.map((step) => ({ id: step.id as number, type: step.type }))];
    if (revalidatedChain.length > 1) {
      void fetch('/api/validate-chain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startPlayerId: puzzle.startPlayer.id,
          targetPlayerId: puzzle.targetPlayer.id,
          chain: revalidatedChain,
        }),
      })
        .then((response) => response.json())
        .then((data) => setResult(data as ValidationResponse))
        .catch(() => setError('Unable to revalidate chain.'));
    }
  }

  function getDisplayLabel(node: ChainNode) {
    if (node.id === null) {
      return 'Select an option';
    }

    const label = (node.type === 'PLAYER' ? catalogLookup.players : catalogLookup.clubs).get(node.id);
    return label ?? 'Select an option';
  }

  const pathSummary = useMemo(() => {
    if (!puzzle) return 'Loading puzzle...';

    const selectedSteps = steps.filter((step) => step.id !== null);
    if (selectedSteps.length === 0) {
      return `Player: ${puzzle.startPlayer.name} → Player: ${puzzle.targetPlayer.name}`;
    }

    const pieces = [`Player: ${puzzle.startPlayer.name}`];
    selectedSteps.forEach((step) => {
      pieces.push(`${step.type === 'PLAYER' ? 'Player' : 'Club'}: ${getDisplayLabel(step)}`);
    });
    pieces.push(`Player: ${puzzle.targetPlayer.name}`);
    return pieces.join(' → ');
  }, [puzzle, steps, catalog]);

  function buildValidationChain(): ChainNode[] {
    if (!puzzle) return [];

    const selectedSteps = steps
      .filter((step) => step.id !== null)
      .map((step) => ({ id: step.id as number, type: step.type }));

    return [{ id: puzzle.startPlayer.id, type: 'PLAYER' as const }, ...selectedSteps, { id: puzzle.targetPlayer.id, type: 'PLAYER' as const }];
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!puzzle) return;

    const lastCompletedStep = steps.findLast((step) => step.id !== null);
    if (!lastCompletedStep) {
      setError('Pick a valid first step before submitting.');
      return;
    }

    const lastStepIndex = steps.findLastIndex((step) => step.id !== null);
    await validateCurrentStep(lastStepIndex);
  }

  return (
    <main style={{ maxWidth: 1000, margin: '0 auto', padding: 24 }}>
      <h1>Football Chain</h1>
      <p>Build your chain by selecting players and clubs from the database.</p>

      <section style={{ background: 'white', borderRadius: 12, padding: 20, boxShadow: '0 6px 20px rgba(0,0,0,0.08)' }}>
        <h2>Today&apos;s puzzle</h2>
        {puzzle ? (
          <>
            <p><strong>Start:</strong> {puzzle.startPlayer.name}</p>
            <p><strong>Target:</strong> {puzzle.targetPlayer.name}</p>
            <p><strong>Summary:</strong> {summary}</p>
          </>
        ) : (
          <p>{error ?? 'Loading...'}</p>
        )}
      </section>

      <section style={{ marginTop: 24, background: 'white', borderRadius: 12, padding: 20, boxShadow: '0 6px 20px rgba(0,0,0,0.08)' }}>
        <h2>Build a chain</h2>
        <p><strong>Path:</strong> {pathSummary}</p>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <div style={{ minWidth: 180, padding: '10px 12px', borderRadius: 10, background: '#eef2ff', border: '1px solid #c7d2fe' }}>
            <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#4338ca' }}>Start</div>
            <div style={{ fontWeight: 700, marginTop: 4 }}>{puzzle?.startPlayer.name ?? 'Loading...'}</div>
          </div>
          <div style={{ minWidth: 180, padding: '10px 12px', borderRadius: 10, background: '#ecfeff', border: '1px solid #a5f3fc' }}>
            <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#0f766e' }}>Goal</div>
            <div style={{ fontWeight: 700, marginTop: 4 }}>{puzzle?.targetPlayer.name ?? 'Loading...'}</div>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          {steps.map((step, index) => {
            const expectedType = index % 2 === 0 ? 'CLUB' : 'PLAYER';
            const entries = expectedType === 'PLAYER' ? sortedPlayers : sortedClubs;
            const query = (stepSearchValues[index] ?? '').trim().toLowerCase();
            const visibleEntries = entries.filter((entry) => entry.name.toLowerCase().includes(query));
            const selectedLabel = getDisplayLabel(step);

            return (
              <div key={`${expectedType}-${index}`} style={{ marginBottom: 14 }}>
                <div
                  key={`shake-${shakeKey}-${index}`}
                  style={{
                    display: 'flex',
                    gap: 12,
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    animation: invalidStepIndex === index ? 'shake 0.35s linear 1' : 'none',
                    border: invalidStepIndex === index ? '1px solid #dc2626' : '1px solid transparent',
                    borderRadius: 10,
                    padding: invalidStepIndex === index ? 8 : 0,
                  }}
                >
                  <div style={{ minWidth: 140, padding: '8px 10px', borderRadius: 8, background: '#f3f4f6', fontWeight: 600 }}>
                    {expectedType === 'PLAYER' ? 'Player' : 'Club'}
                  </div>

                  <div style={{ flex: 1, minWidth: 240, position: 'relative' }}>
                    <input
                      value={query}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        setStepSearchValues((current) => ({ ...current, [index]: nextValue }));
                        setStepShowSuggestions((current) => ({ ...current, [index]: nextValue.trim().length > 0 }));
                        const match = entries.find((entry) => entry.name.toLowerCase() === nextValue.trim().toLowerCase());
                        if (match) {
                          updateStep(index, { id: match.id, type: expectedType });
                        }
                      }}
                      onFocus={() => setStepShowSuggestions((current) => ({ ...current, [index]: (stepSearchValues[index] ?? '').trim().length > 0 }))}
                      onBlur={() => window.setTimeout(() => setStepShowSuggestions((current) => ({ ...current, [index]: false })), 120)}
                      placeholder={expectedType === 'PLAYER' ? 'Type a player name' : 'Type a club name'}
                      style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #d1d5db', background: selectedLabel !== 'Select an option' ? '#eff6ff' : 'white', fontWeight: selectedLabel !== 'Select an option' ? 600 : 400 }}
                    />

                    {stepShowSuggestions[index] && query && visibleEntries.length > 0 ? (
                      <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 5, background: 'white', border: '1px solid #d1d5db', borderRadius: 8, boxShadow: '0 6px 18px rgba(0,0,0,0.08)' }}>
                        {visibleEntries.slice(0, 6).map((entry) => (
                          <button
                            key={entry.id}
                            type="button"
                            onClick={() => {
                              updateStep(index, { id: entry.id, type: expectedType });
                              setStepSearchValues((current) => ({ ...current, [index]: entry.name }));
                              setStepShowSuggestions((current) => ({ ...current, [index]: false }));
                            }}
                            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', border: 'none', background: 'white', cursor: 'pointer' }}
                          >
                            {entry.name}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <button type="button" onClick={() => removeStep(index)} style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #d1d5db', background: 'white', cursor: 'pointer' }}>
                    Remove
                  </button>
                </div>
              </div>
            );
          })}

          <div style={{ marginTop: 12, display: 'flex', gap: 12 }}>
            <button type="submit" disabled={loading} style={{ padding: '10px 16px', borderRadius: 8, border: 'none', background: '#2563eb', color: 'white', cursor: 'pointer' }}>
              {loading ? 'Validating...' : 'Submit link'}
            </button>
          </div>
        </form>

        {error ? <p style={{ color: '#b91c1c' }}>{error}</p> : null}
        {result ? (
          <div style={{ marginTop: 16, padding: 12, borderRadius: 8, background: result.valid ? '#ecfdf3' : '#fef2f2' }}>
            <p><strong>Valid:</strong> {String(result.valid)}</p>
            <p><strong>Solved:</strong> {String(result.solved)}</p>
            {result.reason ? <p><strong>Reason:</strong> {result.reason}</p> : null}
            {result.chainLength ? <p><strong>Chain length:</strong> {result.chainLength}</p> : null}
          </div>
        ) : null}
      </section>

      <style jsx global>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-6px); }
          40% { transform: translateX(6px); }
          60% { transform: translateX(-4px); }
          80% { transform: translateX(4px); }
        }
      `}</style>
    </main>
  );
}
