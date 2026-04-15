-- ============================================================
-- Tippon — RLS Fix Migration
-- Run this in: Supabase Dashboard > SQL Editor
-- ============================================================

-- 1. Check existing policies first (optional, for reference)
-- SELECT * FROM pg_policies WHERE tablename IN ('user_picks', 'tournament_scores');

-- 2. Allow all authenticated users to read user_picks
--    (needed for: player count display + batch score calculation)
DROP POLICY IF EXISTS "authenticated_read_user_picks" ON user_picks;
CREATE POLICY "authenticated_read_user_picks"
  ON user_picks
  FOR SELECT
  TO authenticated
  USING (true);

-- 3. Allow all authenticated users to read tournament_scores
--    (needed for: leaderboard displaying all players)
DROP POLICY IF EXISTS "authenticated_read_tournament_scores" ON tournament_scores;
CREATE POLICY "authenticated_read_tournament_scores"
  ON tournament_scores
  FOR SELECT
  TO authenticated
  USING (true);
