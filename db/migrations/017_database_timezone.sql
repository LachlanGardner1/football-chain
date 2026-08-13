-- rotate-puzzles.ts and every "today" comparison in the app (GET /api/daily/dates, the date
-- picker's min/max, streak correctness) all derive "today" from Postgres's own CURRENT_DATE,
-- deliberately treating the database as the single server-authoritative source of truth
-- instead of any individual server's or Lambda's local clock (which defaults to UTC). That
-- only works if the database's own session timezone is actually set to the app's target
-- timezone - this was set manually and untracked at some point against the original RDS
-- instance, so it silently reverted to UTC when dev moved to a fresh Neon database, and
-- CURRENT_DATE stayed on yesterday until each day's midday UTC rollover caught up with
-- Sydney's local date - exactly the kind of gap a real migration exists to prevent recurring.

BEGIN;

DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'Australia/Sydney');
END $$;

COMMIT;
