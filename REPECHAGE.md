IMPLEMENTATION REQUIREMENT: JUDO REPECHAGE SYSTEM (IJF STANDARD)

Implement the bracket data structure for a Judo prediction app using the official "Quarter-final Repechage" system. Do not use standard double-elimination. Use the following strict node-dependency map to build the application logic, database schema, and bracket UI:

1. POOLS (A, B, C, D): Standard single-elimination up to the Quarter-finals.
2. QUARTER-FINALS (QF):
   - Match QF_A: Winner -> goes to SF_1. Loser -> goes to REP_AB.
   - Match QF_B: Winner -> goes to SF_1. Loser -> goes to REP_AB.
   - Match QF_C: Winner -> goes to SF_2. Loser -> goes to REP_CD.
   - Match QF_D: Winner -> goes to SF_2. Loser -> goes to REP_CD.
3. SEMI-FINALS (SF):
   - Match SF_1 (Winner QF_A vs Winner QF_B): Winner -> goes to FINAL. Loser -> goes to BRONZE_2 (Notice the cross-over).
   - Match SF_2 (Winner QF_C vs Winner QF_D): Winner -> goes to FINAL. Loser -> goes to BRONZE_1 (Notice the cross-over).
4. REPECHAGE ROUND (REP):
   - Match REP_AB (Loser QF_A vs Loser QF_B): Winner -> goes to BRONZE_1. Loser -> Eliminated.
   - Match REP_CD (Loser QF_C vs Loser QF_D): Winner -> goes to BRONZE_2. Loser -> Eliminated.
5. BRONZE MEDAL MATCHES (Cross-over logic is critical):
   - Match BRONZE_1: Winner REP_AB vs Loser SF_2. (Winner gets Bronze).
   - Match BRONZE_2: Winner REP_CD vs Loser SF_1. (Winner gets Bronze).
6. FINAL:
   - Match FINAL: Winner SF_1 vs Winner SF_2. (Winner gets Gold, Loser gets Silver).

CONSTRAINT: The application data model must support 2 distinct Bronze medals. Ensure the cross-over routing in the Bronze matches is strictly adhered to in the code.