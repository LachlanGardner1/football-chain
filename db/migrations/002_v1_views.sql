-- convenience views for daily mode reads

BEGIN;

CREATE OR REPLACE VIEW v_published_daily_puzzles AS
SELECT
  p.id,
  p.puzzle_date,
  p.start_player_id,
  sp.canonical_name AS start_player_name,
  p.target_player_id,
  tp.canonical_name AS target_player_name,
  p.optimal_length,
  p.dataset_version_id,
  p.published_at
FROM daily_puzzles p
JOIN players sp ON sp.id = p.start_player_id
JOIN players tp ON tp.id = p.target_player_id
WHERE p.status = 'PUBLISHED';

CREATE OR REPLACE VIEW v_user_daily_outcomes AS
SELECT
  gr.user_id,
  dp.puzzle_date,
  gr.puzzle_id,
  gr.attempts,
  gr.best_chain_length,
  gr.solved,
  gr.hints_used,
  gr.solved_at
FROM game_results gr
JOIN daily_puzzles dp ON dp.id = gr.puzzle_id;

COMMIT;
