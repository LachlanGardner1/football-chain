'use client';

import { useState } from 'react';

interface DisplayNameModalProps {
  open: boolean;
  onSubmit: (name: string) => Promise<void>;
  onDismiss: () => void;
}

export default function DisplayNameModal({ open, onSubmit, onDismiss }: DisplayNameModalProps) {
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = value.trim();
    if (trimmed.length < 1 || trimmed.length > 24) {
      setError('Name must be 1-24 characters.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(trimmed);
    } catch {
      setError('Could not save your name - try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Enter a display name">
      <div className="panel">
        <h2 className="title">Today&apos;s score is in the books</h2>
        <p className="subtitle">Add a name so it shows up on the leaderboard.</p>
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="Your name"
            maxLength={24}
            autoFocus
            className="name-input"
          />
          {error ? <p className="error-text">{error}</p> : null}
          <div className="actions">
            <button type="button" className="skip-button" onClick={onDismiss} disabled={submitting}>
              Skip for now
            </button>
            <button type="submit" className="save-button" disabled={submitting}>
              {submitting ? 'Saving…' : 'Save name'}
            </button>
          </div>
        </form>
      </div>

      <style jsx>{`
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

        .panel {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-panel);
          box-shadow: var(--shadow-md);
          padding: 24px;
          max-width: 360px;
          width: 100%;
        }

        .title {
          margin: 0 0 6px;
          font-size: 18px;
          color: var(--ink);
        }

        .subtitle {
          margin: 0 0 16px;
          font-size: 14px;
          color: var(--ink-muted);
        }

        .name-input {
          width: 100%;
          padding: 10px 14px;
          border-radius: var(--radius-input);
          border: 1px solid var(--border);
          background: var(--surface-muted);
          color: var(--ink);
          font-size: 15px;
        }

        .name-input:focus {
          border-color: var(--accent);
        }

        .error-text {
          margin: 8px 0 0;
          font-size: 13px;
          color: var(--invalid);
        }

        .actions {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
          margin-top: 16px;
        }

        .skip-button {
          padding: 8px 14px;
          border-radius: var(--radius-pill);
          border: 1px solid var(--border);
          background: transparent;
          color: var(--ink-muted);
          font-weight: 600;
          font-size: 13px;
          cursor: pointer;
        }

        .save-button {
          padding: 8px 16px;
          border-radius: var(--radius-pill);
          border: none;
          background: var(--accent);
          color: var(--bg);
          font-weight: 700;
          font-size: 13px;
          cursor: pointer;
        }

        .save-button:disabled,
        .skip-button:disabled {
          opacity: 0.6;
          cursor: default;
        }
      `}</style>
    </div>
  );
}
