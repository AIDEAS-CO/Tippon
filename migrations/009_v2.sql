-- ============================================================
-- Tippon — Migration 009 (v2)
-- Run in: Supabase Dashboard > SQL Editor
--
-- Idempotent: safe to run more than once.
--
-- Adds:
--   1. categories.day, gender 'Mixed' (mixed team events)
--   2. tournaments.picks_locked / bracket_draft / bracket_draft_updated_at /
--      golden_matches / end_date
--   3. Unique constraints required by app upserts (competition_brackets,
--      user_picks, match_results, tournament_scores)
--   4. Helper functions: is_admin(), picks_open(), picks_visible()
--   5. Server-enforced pick lock + pick visibility RLS on user_picks
--   6. Realtime publication for categories, tournaments, tournament_scores
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. categories: competition day + 'Mixed' gender
-- ------------------------------------------------------------
ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS day smallint;

-- The schema dump shows no CHECK constraint on categories.gender, but if one
-- was added manually, drop it and recreate it including 'Mixed'.
-- NOT VALID: existing legacy rows are not re-checked; new/updated rows are.
DO $$
DECLARE
  r record;
  had_check boolean := false;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'public.categories'::regclass
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%gender%'
  LOOP
    EXECUTE format('ALTER TABLE public.categories DROP CONSTRAINT %I', r.conname);
    had_check := true;
  END LOOP;

  IF had_check THEN
    ALTER TABLE public.categories
      ADD CONSTRAINT categories_gender_check
      CHECK (gender IN ('Male', 'Female', 'Mixed')) NOT VALID;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 2. tournaments: global lock, draw-parser draft autosave,
--    golden matches, end date
-- ------------------------------------------------------------
ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS picks_locked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bracket_draft jsonb,
  ADD COLUMN IF NOT EXISTS bracket_draft_updated_at timestamptz,
  -- [{ "category": text, "matchId": text, "points": number }]
  ADD COLUMN IF NOT EXISTS golden_matches jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS end_date date;

-- ------------------------------------------------------------
-- 3. Unique constraints relied upon by app upserts
-- ------------------------------------------------------------

-- Session-local helper: true if the table has a non-partial unique index
-- (or unique/PK constraint) on exactly the given set of columns.
CREATE OR REPLACE FUNCTION pg_temp.has_unique_on(tbl regclass, cols text[])
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM pg_index i
    WHERE i.indrelid = tbl
      AND i.indisunique
      AND i.indpred IS NULL
      AND i.indexprs IS NULL
      AND (
        SELECT array_agg(a.attname::text ORDER BY a.attname::text)
        FROM pg_attribute a
        WHERE a.attrelid = tbl
          AND a.attnum = ANY (i.indkey)
      ) = (SELECT array_agg(c ORDER BY c) FROM unnest(cols) AS c)
  );
$$;

-- 3a. competition_brackets (tournament_id, weight_category, match_number)
--     Used by the draw-parser publish upsert.
DO $$
BEGIN
  IF NOT pg_temp.has_unique_on('public.competition_brackets'::regclass,
                               ARRAY['tournament_id', 'weight_category', 'match_number']) THEN

    -- Remove duplicate rows on the key before adding the constraint.
    -- Keeps the row with the lowest id per (tournament_id, weight_category, match_number).
    -- Rows with a NULL in any key column are not duplicates for a UNIQUE
    -- constraint, so they are left untouched.
    CREATE TEMP TABLE _cb_dupes ON COMMIT DROP AS
    SELECT id, keep_id
    FROM (
      SELECT id,
             first_value(id) OVER w AS keep_id,
             row_number()    OVER w AS rn
      FROM public.competition_brackets
      WHERE tournament_id IS NOT NULL
        AND weight_category IS NOT NULL
        AND match_number IS NOT NULL
      WINDOW w AS (PARTITION BY tournament_id, weight_category, match_number ORDER BY id)
    ) s
    WHERE rn > 1;

    -- Legacy actual_results.match_id has an FK to competition_brackets.id:
    -- re-point any references to the kept row so the delete cannot fail.
    UPDATE public.actual_results ar
       SET match_id = d.keep_id
      FROM _cb_dupes d
     WHERE ar.match_id = d.id;

    DELETE FROM public.competition_brackets cb
     USING _cb_dupes d
     WHERE cb.id = d.id;

    ALTER TABLE public.competition_brackets
      ADD CONSTRAINT competition_brackets_tournament_category_match_key
      UNIQUE (tournament_id, weight_category, match_number);
  END IF;
END $$;

-- 3b. user_picks / match_results / tournament_scores
--     These should already exist from Migrations 002–004. If missing, try to
--     add them; if existing duplicates block it, emit a WARNING and continue
--     (clean the duplicates manually, then re-run this migration).
DO $$
BEGIN
  IF NOT pg_temp.has_unique_on('public.user_picks'::regclass,
                               ARRAY['user_id', 'tournament_id', 'category']) THEN
    BEGIN
      ALTER TABLE public.user_picks
        ADD CONSTRAINT user_picks_user_id_tournament_id_category_key
        UNIQUE (user_id, tournament_id, category);
    EXCEPTION WHEN unique_violation THEN
      RAISE WARNING 'user_picks has duplicate (user_id, tournament_id, category) rows; unique constraint NOT added.';
    END;
  END IF;

  IF NOT pg_temp.has_unique_on('public.match_results'::regclass,
                               ARRAY['tournament_id', 'category', 'match_id']) THEN
    BEGIN
      ALTER TABLE public.match_results
        ADD CONSTRAINT match_results_tournament_id_category_match_id_key
        UNIQUE (tournament_id, category, match_id);
    EXCEPTION WHEN unique_violation THEN
      RAISE WARNING 'match_results has duplicate (tournament_id, category, match_id) rows; unique constraint NOT added.';
    END;
  END IF;

  IF NOT pg_temp.has_unique_on('public.tournament_scores'::regclass,
                               ARRAY['user_id', 'tournament_id', 'category']) THEN
    BEGIN
      ALTER TABLE public.tournament_scores
        ADD CONSTRAINT tournament_scores_user_id_tournament_id_category_key
        UNIQUE (user_id, tournament_id, category);
    EXCEPTION WHEN unique_violation THEN
      RAISE WARNING 'tournament_scores has duplicate (user_id, tournament_id, category) rows; unique constraint NOT added.';
    END;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 4. Helper functions (SECURITY DEFINER so they can read
--    profiles/tournaments/categories regardless of caller RLS)
-- ------------------------------------------------------------

-- True when the current user is an admin.
-- profiles.role is the user_role enum; compare as upper-cased text so this
-- works whether the enum label is 'ADMIN' or 'admin'.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND upper(p.role::text) = 'ADMIN'
  );
$$;

-- True when picks for (tournament, category) may still be written.
--   * tournaments.picks_locked = true          -> false (global lock)
--   * '_medal_table_*' keys                     -> medal_table_status is NULL or 'open'
--   * '_bonuses_' (synthetic scoring row)       -> false
--   * weight category                           -> categories.status is NULL or 'open'
--       Category names are compared normalized like the app (lib/rankings.ts
--       weightsMatch): lower-case, whitespace removed, leading gender prefix
--       (men/men's/women/women's/male/female) removed, trailing 'kg' removed
--       ('Men -60kg' = '-60 kg' = '-60kg' = '-60').
--       No matching categories row -> true.
--   * unknown tournament                        -> false
CREATE OR REPLACE FUNCTION public.picks_open(t_id bigint, cat text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN t.id IS NULL THEN false
    WHEN coalesce(t.picks_locked, false) THEN false
    WHEN cat LIKE '\_medal\_table\_%' THEN
      t.medal_table_status IS NULL OR t.medal_table_status = 'open'
    WHEN cat = '_bonuses_' THEN false
    ELSE NOT EXISTS (
      SELECT 1
      FROM public.categories c
      WHERE c.tournament_id = t_id
        AND regexp_replace(regexp_replace(regexp_replace(lower(c.name), '\s+', '', 'g'),
                                          '^(men''?s?|women''?s?|male|female)', ''), 'kg$', '')
          = regexp_replace(regexp_replace(regexp_replace(lower(cat),    '\s+', '', 'g'),
                                          '^(men''?s?|women''?s?|male|female)', ''), 'kg$', '')
        AND coalesce(c.status, 'open') <> 'open'
    )
  END
  FROM (SELECT 1) AS one
  LEFT JOIN public.tournaments t ON t.id = t_id;
$$;

-- True when other users' picks for (tournament, category) may be read:
-- exactly when picks are no longer open (locked or closed).
-- For medal table keys this means medal_table_status IN ('locked','closed')
-- (or the global picks_locked flag is set).
CREATE OR REPLACE FUNCTION public.picks_visible(t_id bigint, cat text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT public.picks_open(t_id, cat);
$$;

GRANT EXECUTE ON FUNCTION public.is_admin()                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.picks_open(bigint, text)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.picks_visible(bigint, text) TO authenticated;

-- ------------------------------------------------------------
-- 5. RLS on user_picks: server-enforced lock + visibility
-- ------------------------------------------------------------
ALTER TABLE public.user_picks ENABLE ROW LEVEL SECURITY;

-- Old SELECT policies (Migration 002, Migration 005, SUPABASE_MIGRATION.sql).
-- Permissive policies are OR-ed, so any leftover "read all" policy would
-- defeat the new visibility rule — all of them must go.
DROP POLICY IF EXISTS "Users see own picks"                    ON public.user_picks;
DROP POLICY IF EXISTS "Authenticated users can read all picks" ON public.user_picks;
DROP POLICY IF EXISTS "authenticated_read_user_picks"          ON public.user_picks;

-- Old INSERT / UPDATE policies (Migration 002).
DROP POLICY IF EXISTS "Users insert own picks" ON public.user_picks;
DROP POLICY IF EXISTS "Users update own picks" ON public.user_picks;

-- New policies (dropped first so re-runs are idempotent).
DROP POLICY IF EXISTS "Read own, locked, or admin picks"   ON public.user_picks;
DROP POLICY IF EXISTS "Insert own picks while open"        ON public.user_picks;
DROP POLICY IF EXISTS "Update own picks while open"        ON public.user_picks;

-- SELECT: own rows always; everyone's rows once that category is locked/closed;
-- admins read all (batch scoring runs in the admin browser session).
CREATE POLICY "Read own, locked, or admin picks"
  ON public.user_picks
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_id
    OR public.picks_visible(tournament_id, category)
    OR public.is_admin()
  );

-- INSERT: only own rows, only while picks are open.
CREATE POLICY "Insert own picks while open"
  ON public.user_picks
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND public.picks_open(tournament_id, category)
  );

-- UPDATE: only own rows, only while picks are open (both for the existing row
-- and the new values, so a row cannot be moved into a locked category).
CREATE POLICY "Update own picks while open"
  ON public.user_picks
  FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = user_id
    AND public.picks_open(tournament_id, category)
  )
  WITH CHECK (
    auth.uid() = user_id
    AND public.picks_open(tournament_id, category)
  );

-- DELETE policy is intentionally left unchanged.

-- Report any other SELECT/INSERT/UPDATE/ALL policies still on user_picks
-- (e.g. created manually in the dashboard). They are OR-ed with the policies
-- above and may bypass the lock — review and drop them if so.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT policyname, cmd
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_picks'
      AND cmd IN ('SELECT', 'INSERT', 'UPDATE', 'ALL')
      AND policyname NOT IN (
        'Read own, locked, or admin picks',
        'Insert own picks while open',
        'Update own picks while open'
      )
  LOOP
    RAISE WARNING 'user_picks still has policy "%" (%); it may bypass the pick lock.', r.policyname, r.cmd;
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 6. Realtime: broadcast changes for categories, tournaments,
--    tournament_scores
-- ------------------------------------------------------------
DO $$
DECLARE
  tbl text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE WARNING 'Publication supabase_realtime not found; realtime step skipped.';
    RETURN;
  END IF;

  FOREACH tbl IN ARRAY ARRAY['categories', 'tournaments', 'tournament_scores'] LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = tbl
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', tbl);
    END IF;
  END LOOP;
END $$;

COMMIT;
