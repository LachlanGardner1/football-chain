BEGIN;

CREATE OR REPLACE FUNCTION refresh_user_streak(p_user_id UUID, p_solved_date DATE)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  existing_last DATE;
  existing_current INTEGER;
  existing_max INTEGER;
  next_current INTEGER;
  next_max INTEGER;
BEGIN
  SELECT last_solved_date, current_streak, max_streak
  INTO existing_last, existing_current, existing_max
  FROM user_streaks
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO user_streaks (user_id, current_streak, max_streak, last_solved_date, updated_at)
    VALUES (p_user_id, 1, 1, p_solved_date, NOW());
    RETURN;
  END IF;

  IF existing_last = p_solved_date THEN
    RETURN;
  END IF;

  IF existing_last = (p_solved_date - INTERVAL '1 day')::DATE THEN
    next_current := existing_current + 1;
  ELSE
    next_current := 1;
  END IF;

  next_max := GREATEST(existing_max, next_current);

  UPDATE user_streaks
  SET
    current_streak = next_current,
    max_streak = next_max,
    last_solved_date = p_solved_date,
    updated_at = NOW()
  WHERE user_id = p_user_id;
END;
$$;

COMMIT;
