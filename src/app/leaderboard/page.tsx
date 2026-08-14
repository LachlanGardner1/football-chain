'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle, House, Moon, Sun, Trophy, XCircle } from '@phosphor-icons/react';

import { isTheme, THEME_STORAGE_KEY, type Theme } from '../theme';
import { apiFetch } from '../api-fetch';

type AvailableDates = { dates: string[]; today: string };

type DailyEntry = {
  userId: string;
  displayName: string | null;
  solved: boolean;
  chainLength: number | null;
  score: number;
};

type DailyLeaderboard = {
  date: string;
  isToday: boolean;
  locked: boolean;
  viewerUserId: string;
  entries: DailyEntry[];
};

type DuelRankingEntry = {
  userId: string;
  displayName: string | null;
  wins: number;
  losses: number;
  rating: number;
};

type DuelRankingsResponse = { viewerUserId: string; rankings: DuelRankingEntry[] };

type DuelPlayerDetail = DuelRankingEntry & {
  recentMatches: Array<{
    matchId: number;
    opponentUserId: string | null;
    opponentDisplayName: string | null;
    won: boolean;
    forfeited: boolean;
    finishedAt: string | null;
  }>;
};

function todayLocalIso(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function LeaderboardPage() {
  const [theme, setTheme] = useState<Theme>('dark');
  const [activeTab, setActiveTab] = useState<'daily' | 'duels'>('daily');

  // Lazy initializer runs once on the client only - reading window.location.search directly
  // here (rather than next/navigation's useSearchParams) avoids that hook's Suspense-boundary
  // requirement, which isn't a pattern used anywhere else in this codebase.
  const [selectedDate, setSelectedDate] = useState(() => {
    if (typeof window === 'undefined') return todayLocalIso();
    const fromQuery = new URLSearchParams(window.location.search).get('date');
    return fromQuery ?? todayLocalIso();
  });
  const [availableDates, setAvailableDates] = useState<AvailableDates | null>(null);
  const [dailyData, setDailyData] = useState<DailyLeaderboard | null>(null);

  const [rankings, setRankings] = useState<DuelRankingEntry[]>([]);
  const [viewerUserId, setViewerUserId] = useState<string | null>(null);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [playerDetail, setPlayerDetail] = useState<DuelPlayerDetail | null>(null);

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

  useEffect(() => {
    apiFetch('/api/daily/dates')
      .then((res) => res.json())
      .then((data: AvailableDates) => setAvailableDates(data))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    apiFetch(`/api/leaderboard/daily?date=${encodeURIComponent(selectedDate)}`)
      .then((res) => res.json())
      .then((data: DailyLeaderboard) => setDailyData(data))
      .catch(() => undefined);
  }, [selectedDate]);

  useEffect(() => {
    if (activeTab !== 'duels') return;
    apiFetch('/api/leaderboard/duels')
      .then((res) => res.json())
      .then((data: DuelRankingsResponse) => {
        setRankings(data.rankings);
        setViewerUserId(data.viewerUserId);
      })
      .catch(() => undefined);
  }, [activeTab]);

  useEffect(() => {
    if (!selectedPlayerId) {
      setPlayerDetail(null);
      return;
    }
    apiFetch(`/api/leaderboard/duels/${selectedPlayerId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: DuelPlayerDetail | null) => setPlayerDetail(data))
      .catch(() => undefined);
  }, [selectedPlayerId]);

  return (
    <main className="page">
      <header className="header">
        <div className="header-inner">
          <Link href="/" className="brand">
            <span className="brand-mark" aria-hidden="true">
              <Trophy size={24} weight="duotone" />
            </span>
            <div>
              <h1 className="brand-title">Football Chain</h1>
              <p className="brand-subtitle">Leaderboard - daily high scores and duel rankings.</p>
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
        <div className="tabs">
          <button
            type="button"
            className={activeTab === 'daily' ? 'tab tab--active' : 'tab'}
            onClick={() => setActiveTab('daily')}
          >
            Daily
          </button>
          <button
            type="button"
            className={activeTab === 'duels' ? 'tab tab--active' : 'tab'}
            onClick={() => setActiveTab('duels')}
          >
            Duels
          </button>
        </div>

        {activeTab === 'daily' ? (
          <section className="panel">
            <div className="date-row">
              <input
                type="date"
                value={selectedDate}
                min={availableDates?.dates[0]}
                max={availableDates?.today}
                onChange={(event) => setSelectedDate(event.target.value)}
                className="date-input"
              />
            </div>

            {!dailyData ? (
              <p className="hint">Loading...</p>
            ) : dailyData.locked ? (
              <div className="locked-state">
                <p className="hint">Play today&apos;s puzzle first to see today&apos;s leaderboard.</p>
                <Link href="/" className="home-button home-button--inline">
                  <House size={16} weight="fill" />
                  Go play
                </Link>
              </div>
            ) : dailyData.entries.length === 0 ? (
              <p className="hint">Nobody has locked in a score for this date yet.</p>
            ) : (
              <table className="board">
                <thead>
                  <tr>
                    <th className="rank">#</th>
                    <th>Name</th>
                    <th className="outcome"> </th>
                    <th className="chain">Chain</th>
                    <th className="score">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {dailyData.entries.map((entry, index) => (
                    <tr
                      key={entry.userId}
                      className={entry.userId === dailyData.viewerUserId ? 'board-row board-row--you' : 'board-row'}
                    >
                      <td className="rank">{index + 1}</td>
                      <td>{entry.displayName ?? 'Player'}</td>
                      <td className="outcome">
                        {entry.solved ? (
                          <CheckCircle size={14} weight="fill" className="icon-valid" />
                        ) : (
                          <XCircle size={14} weight="fill" className="icon-invalid" />
                        )}
                      </td>
                      <td className="chain">{entry.chainLength ?? '-'}</td>
                      <td className="score">{entry.score}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        ) : (
          <section className="panel">
            {rankings.length === 0 ? (
              <p className="hint">No duels have been played yet.</p>
            ) : (
              <table className="board">
                <thead>
                  <tr>
                    <th className="rank">#</th>
                    <th>Name</th>
                    <th className="chain">W</th>
                    <th className="chain">L</th>
                    <th className="score">Rating</th>
                  </tr>
                </thead>
                <tbody>
                  {rankings.map((entry, index) => (
                    <tr
                      key={entry.userId}
                      className={entry.userId === viewerUserId ? 'board-row board-row--you board-row--clickable' : 'board-row board-row--clickable'}
                      onClick={() => setSelectedPlayerId(entry.userId)}
                    >
                      <td className="rank">{index + 1}</td>
                      <td>{entry.displayName ?? 'Player'}</td>
                      <td className="chain">{entry.wins}</td>
                      <td className="chain">{entry.losses}</td>
                      <td className="score">{entry.rating}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}
      </div>

      {playerDetail ? (
        <div className="overlay" role="dialog" aria-modal="true" onClick={() => setSelectedPlayerId(null)}>
          <div className="detail-panel" onClick={(event) => event.stopPropagation()}>
            <h2 className="detail-title">{playerDetail.displayName ?? 'Player'}</h2>
            <div className="detail-stats">
              <div>
                <div className="detail-stat-value">{playerDetail.rating}</div>
                <div className="detail-stat-label">Rating</div>
              </div>
              <div>
                <div className="detail-stat-value">{playerDetail.wins}</div>
                <div className="detail-stat-label">Wins</div>
              </div>
              <div>
                <div className="detail-stat-value">{playerDetail.losses}</div>
                <div className="detail-stat-label">Losses</div>
              </div>
            </div>
            {playerDetail.recentMatches.length > 0 ? (
              <ul className="match-list">
                {playerDetail.recentMatches.map((match) => (
                  <li key={match.matchId} className="match-row">
                    <span className={match.won ? 'match-outcome match-outcome--win' : 'match-outcome match-outcome--loss'}>
                      {match.won ? 'Win' : 'Loss'}
                    </span>
                    <span className="match-opponent">vs {match.opponentDisplayName ?? 'Player'}</span>
                    {match.forfeited ? <span className="match-forfeit">forfeit</span> : null}
                  </li>
                ))}
              </ul>
            ) : null}
            <button type="button" className="close-button" onClick={() => setSelectedPlayerId(null)}>
              Close
            </button>
          </div>
        </div>
      ) : null}

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

        .home-button--inline {
          border-color: var(--border);
          color: var(--accent);
          margin-top: 8px;
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

        .tabs {
          display: flex;
          gap: 8px;
        }

        .tab {
          padding: 8px 16px;
          border-radius: var(--radius-pill);
          border: 1px solid var(--border);
          background: var(--surface);
          color: var(--ink-muted);
          font-weight: 700;
          font-size: 13px;
          cursor: pointer;
        }

        .tab--active {
          background: var(--accent-soft);
          border-color: var(--accent-soft-border);
          color: var(--accent-strong);
        }

        .panel {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-panel);
          padding: 24px;
          box-shadow: var(--shadow-sm);
        }

        .date-row {
          margin-bottom: 16px;
        }

        .date-input {
          padding: 10px 14px;
          border-radius: var(--radius-input);
          border: 1.5px solid var(--border);
          background: var(--surface-muted);
          color: var(--ink);
          font-size: 14px;
        }

        .hint {
          margin: 0;
          font-size: 13px;
          color: var(--ink-muted);
          line-height: 1.5;
        }

        .locked-state {
          text-align: center;
          padding: 20px 0;
        }

        .board {
          width: 100%;
          border-collapse: collapse;
          font-size: 14px;
        }

        .board thead th {
          text-align: left;
          padding: 6px 8px;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: var(--ink-muted);
        }

        .board-row td {
          padding: 8px;
          border-top: 1px solid var(--border);
          color: var(--ink);
        }

        .board-row--you {
          background: var(--accent-soft);
        }

        .board-row--clickable {
          cursor: pointer;
        }

        .board-row--clickable:hover {
          background: var(--surface-muted);
        }

        .rank {
          color: var(--ink-muted);
          width: 24px;
        }

        .chain,
        .score {
          text-align: right;
          font-variant-numeric: tabular-nums;
        }

        .icon-valid {
          color: var(--valid);
        }

        .icon-invalid {
          color: var(--invalid);
        }

        .overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 100;
          padding: 16px;
        }

        .detail-panel {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-panel);
          box-shadow: var(--shadow-md);
          padding: 24px;
          max-width: 360px;
          width: 100%;
        }

        .detail-title {
          margin: 0 0 16px;
          font-size: 18px;
          color: var(--ink);
        }

        .detail-stats {
          display: flex;
          gap: 20px;
          margin-bottom: 16px;
        }

        .detail-stat-value {
          font-size: 22px;
          font-weight: 700;
          color: var(--ink);
        }

        .detail-stat-label {
          font-size: 11px;
          text-transform: uppercase;
          color: var(--ink-muted);
        }

        .match-list {
          list-style: none;
          margin: 0 0 16px;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .match-row {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 13px;
        }

        .match-outcome {
          font-weight: 700;
          width: 40px;
        }

        .match-outcome--win {
          color: var(--valid);
        }

        .match-outcome--loss {
          color: var(--invalid);
        }

        .match-opponent {
          color: var(--ink-muted);
        }

        .match-forfeit {
          font-size: 11px;
          color: var(--repeat);
          text-transform: uppercase;
        }

        .close-button {
          padding: 8px 16px;
          border-radius: var(--radius-pill);
          border: 1px solid var(--border);
          background: transparent;
          color: var(--ink-muted);
          font-weight: 600;
          font-size: 13px;
          cursor: pointer;
        }
      `}</style>
    </main>
  );
}
