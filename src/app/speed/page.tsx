'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Flag, House, Moon, SoccerBall, Sun } from '@phosphor-icons/react';

import { isTheme, THEME_STORAGE_KEY, type Theme } from '../theme';

type CreateResponse = { matchId: number; inviteCode: string };

export default function SpeedRoundHomePage() {
  const router = useRouter();
  const [theme, setTheme] = useState<Theme>('dark');
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [codeInput, setCodeInput] = useState('');
  const [error, setError] = useState<string | null>(null);

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

  async function handleCreate() {
    setCreating(true);
    setError(null);
    try {
      const response = await fetch('/api/speed-round/create', { method: 'POST' });
      if (!response.ok) throw new Error('Unable to create a race right now.');
      const data = (await response.json()) as CreateResponse;
      // The invite code, not the numeric matchId - that's the shareable/unguessable part of
      // the link, and it's also what the match page itself resolves back into a matchId on
      // load (see src/app/speed/[code]/page.tsx), so joining only ever happens one way.
      router.push(`/speed/${data.inviteCode}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create a race right now.');
      setCreating(false);
    }
  }

  function handleJoin(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = codeInput.trim();
    if (!trimmed) return;

    setJoining(true);
    // Actually joining happens on the match page itself (it resolves the code in the URL to a
    // matchId on mount) - this just navigates there, so there's one single place that owns the
    // join call rather than two.
    router.push(`/speed/${trimmed}`);
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
              <p className="brand-subtitle">Speed Round - race a friend to link 3 legends. No hints, no score.</p>
            </div>
          </Link>
          <div className="header-actions">
            <Link href="/" className="home-button" title="Back to the daily puzzle">
              <House size={16} weight="fill" />
              Daily puzzle
            </Link>
            <button
              type="button"
              onClick={toggleTheme}
              className="theme-toggle"
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? <Sun size={18} weight="fill" /> : <Moon size={18} weight="fill" />}
            </button>
          </div>
        </div>
      </header>

      <div className="container">
        <section className="panel">
          <span className="panel-icon">
            <SoccerBall size={22} weight="duotone" />
          </span>
          <h2 className="panel-title">Start a race</h2>
          <p className="hint">
            You&apos;ll get a link to send a friend. Once you&apos;re both on the page, the race starts with a 5 second
            countdown.
          </p>
          <button type="button" onClick={handleCreate} disabled={creating} className="btn btn-primary">
            {creating ? 'Creating...' : 'Create a race'}
          </button>
        </section>

        <section className="panel">
          <h2 className="panel-title">Join with a code</h2>
          <p className="hint">Got sent a link or a code? Enter it here.</p>
          <form onSubmit={handleJoin} className="join-form">
            <input
              value={codeInput}
              onChange={(event) => setCodeInput(event.target.value.toUpperCase())}
              placeholder="e.g. 7HBH7W"
              maxLength={6}
              className="code-input"
            />
            <button type="submit" disabled={joining || !codeInput.trim()} className="btn btn-primary">
              {joining ? 'Joining...' : 'Join race'}
            </button>
          </form>
        </section>

        {error ? <p className="error-text">{error}</p> : null}
      </div>

      <style jsx>{`
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
          max-width: 640px;
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
          font-size: 24px;
          font-weight: 700;
          letter-spacing: -0.02em;
        }

        .brand-subtitle {
          margin: 2px 0 0;
          font-size: 13px;
          opacity: 0.8;
          max-width: 40ch;
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
          max-width: 640px;
          margin: 0 auto;
          padding: 24px 20px 60px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .panel {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-panel);
          padding: 24px;
          box-shadow: var(--shadow-sm);
        }

        .panel-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 36px;
          height: 36px;
          border-radius: var(--radius-pill);
          background: var(--accent-soft);
          color: var(--accent-strong);
          margin-bottom: 10px;
        }

        .panel-title {
          margin: 0 0 6px;
          font-size: 18px;
          font-weight: 700;
        }

        .hint {
          margin: 0 0 16px;
          font-size: 13px;
          color: var(--ink-muted);
          line-height: 1.5;
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

        .join-form {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }

        .code-input {
          flex: 1;
          min-width: 140px;
          padding: 12px 14px;
          border-radius: var(--radius-input);
          border: 1.5px solid var(--border);
          background: var(--surface-muted);
          color: var(--ink);
          font-family: var(--font-mono);
          font-size: 16px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }

        .error-text {
          color: var(--invalid);
          font-size: 14px;
          margin: 0;
        }
      `}</style>
    </main>
  );
}
