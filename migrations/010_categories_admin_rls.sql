-- ============================================================
-- Tippon — Migration 010
-- Run in: Supabase Dashboard > SQL Editor
--
-- Idempotent: safe to run more than once.
--
-- Problem: categories has RLS enabled but no UPDATE/DELETE policy for admins,
-- so Lock / Reopen / Close category, Lock all picks and the Day editor were
-- silently ignored (0 rows updated). Requires is_admin() from Migration 009.
--
-- Part 2 adds the same admin write policies (is_admin(), additive/permissive)
-- to every other table the admin UI writes, so no admin action can be
-- silently filtered by RLS:
--   tournaments          wizard, status, locks, golden matches, bracket draft
--   competition_brackets bracket publish (upsert/insert/delete), drag & drop
--   match_results        results entry / PDF import (upsert), category delete
--   tournament_scores    batch scoring for ALL users (upsert), deletes
--   tournament_roster    roster import / delete
--   user_picks           DELETE only (category / tournament delete)
-- Part 2 does NOT enable RLS on any table: on a table with RLS disabled the
-- policies are inert; nothing that works today can break.
-- ============================================================

BEGIN;

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can insert categories" ON public.categories;
DROP POLICY IF EXISTS "Admins can update categories" ON public.categories;
DROP POLICY IF EXISTS "Admins can delete categories" ON public.categories;

CREATE POLICY "Admins can insert categories"
  ON public.categories
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins can update categories"
  ON public.categories
  FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins can delete categories"
  ON public.categories
  FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- ------------------------------------------------------------
-- Part 2: admin write policies on the other admin-written tables
-- ------------------------------------------------------------
-- tournaments
DROP POLICY IF EXISTS "Admins can insert tournaments" ON public.tournaments;
DROP POLICY IF EXISTS "Admins can update tournaments" ON public.tournaments;
DROP POLICY IF EXISTS "Admins can delete tournaments" ON public.tournaments;
CREATE POLICY "Admins can insert tournaments" ON public.tournaments
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY "Admins can update tournaments" ON public.tournaments
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Admins can delete tournaments" ON public.tournaments
  FOR DELETE TO authenticated USING (public.is_admin());
-- competition_brackets
DROP POLICY IF EXISTS "Admins can insert competition_brackets" ON public.competition_brackets;
DROP POLICY IF EXISTS "Admins can update competition_brackets" ON public.competition_brackets;
DROP POLICY IF EXISTS "Admins can delete competition_brackets" ON public.competition_brackets;
CREATE POLICY "Admins can insert competition_brackets" ON public.competition_brackets
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY "Admins can update competition_brackets" ON public.competition_brackets
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Admins can delete competition_brackets" ON public.competition_brackets
  FOR DELETE TO authenticated USING (public.is_admin());
-- match_results
DROP POLICY IF EXISTS "Admins can insert match_results" ON public.match_results;
DROP POLICY IF EXISTS "Admins can update match_results" ON public.match_results;
DROP POLICY IF EXISTS "Admins can delete match_results" ON public.match_results;
CREATE POLICY "Admins can insert match_results" ON public.match_results
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY "Admins can update match_results" ON public.match_results
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Admins can delete match_results" ON public.match_results
  FOR DELETE TO authenticated USING (public.is_admin());
-- tournament_scores
DROP POLICY IF EXISTS "Admins can insert tournament_scores" ON public.tournament_scores;
DROP POLICY IF EXISTS "Admins can update tournament_scores" ON public.tournament_scores;
DROP POLICY IF EXISTS "Admins can delete tournament_scores" ON public.tournament_scores;
CREATE POLICY "Admins can insert tournament_scores" ON public.tournament_scores
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY "Admins can update tournament_scores" ON public.tournament_scores
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Admins can delete tournament_scores" ON public.tournament_scores
  FOR DELETE TO authenticated USING (public.is_admin());
-- tournament_roster
DROP POLICY IF EXISTS "Admins can insert tournament_roster" ON public.tournament_roster;
DROP POLICY IF EXISTS "Admins can update tournament_roster" ON public.tournament_roster;
DROP POLICY IF EXISTS "Admins can delete tournament_roster" ON public.tournament_roster;
CREATE POLICY "Admins can insert tournament_roster" ON public.tournament_roster
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY "Admins can update tournament_roster" ON public.tournament_roster
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Admins can delete tournament_roster" ON public.tournament_roster
  FOR DELETE TO authenticated USING (public.is_admin());
-- user_picks: admin DELETE only (INSERT/UPDATE stay owner-only + picks_open(), Migration 009)
DROP POLICY IF EXISTS "Admins can delete user_picks" ON public.user_picks;
CREATE POLICY "Admins can delete user_picks" ON public.user_picks
  FOR DELETE TO authenticated USING (public.is_admin());

COMMIT;

-- Check (run after):
-- SELECT tablename, policyname, cmd FROM pg_policies
--  WHERE schemaname = 'public' ORDER BY tablename, cmd;
-- Tables with RLS enabled (policies only apply there):
-- SELECT relname, relrowsecurity FROM pg_class
--  WHERE relnamespace = 'public'::regnamespace AND relkind = 'r';
-- If is_admin() returns false for your admin account, check profiles.role:
-- SELECT id, role FROM public.profiles WHERE id = auth.uid();
