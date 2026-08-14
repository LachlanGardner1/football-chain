'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle, XCircle } from '@phosphor-icons/react';

import { apiFetch } from '../api-fetch';

type Entry = {
  userId: string;
  displayName: string | null;
  solved: boolean;
  chainLength: number | null;
  score: number;
};

type DailyLeaderboardResponse = {
  date: string;
  locked: boolean;
  viewerUserId: string;
  entries: Entry[];
};

const PREVIEW_LIMIT = 10;

interface DailyLeaderboardPreviewProps {
  date: string;
}

export default function DailyLeaderboardPreview({ date }: DailyLeaderboardPreviewProps) {
  const [data, setData] = useState<DailyLeaderboardResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch(`/api/leaderboard/daily?date=${encodeURIComponent(date)}`)
      .then((res) => res.json())
      .then((result: DailyLeaderboardResponse) => {
        if (!cancelled) setData(result);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [date]);

  if (!data || data.locked || data.entries.length === 0) return null;

  const rows = data.entries.slice(0, PREVIEW_LIMIT);

  return (
    <section className="panel">
      <h2 className="panel-title">Today&apos;s leaderboard</h2>
      <table className="board">
        <tbody>
          {rows.map((entry, index) => (
            <tr key={entry.userId} className={entry.userId === data.viewerUserId ? 'board-row board-row--you' : 'board-row'}>
              <td className="rank">{index + 1}</td>
              <td className="name">{entry.displayName ?? 'Player'}</td>
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
      <Link href={`/leaderboard?date=${encodeURIComponent(date)}`} className="view-full-link">
        View full leaderboard
      </Link>

      <style jsx global>{`
        .panel {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-panel);
          padding: 20px;
          margin-top: 16px;
        }

        .panel-title {
          margin: 0 0 12px;
          font-size: 16px;
          color: var(--ink);
        }

        .board {
          width: 100%;
          border-collapse: collapse;
          font-size: 14px;
        }

        .board-row td {
          padding: 6px 8px;
          border-top: 1px solid var(--border);
          color: var(--ink);
        }

        .board-row--you {
          background: var(--accent-soft);
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

        .view-full-link {
          display: inline-block;
          margin-top: 12px;
          font-size: 13px;
          color: var(--accent);
          text-decoration: none;
          font-weight: 600;
        }

        .view-full-link:hover {
          text-decoration: underline;
        }
      `}</style>
    </section>
  );
}
