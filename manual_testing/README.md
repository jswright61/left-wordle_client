# Manual Multi-Device Sync Testing

These fixtures exercise the multi-device login/sync paths in `src/auth.js` and
`api/app.rb` -- the same paths behind the staging bug where logging in from a
second browser produced *"Logged in, but syncing your account data failed —
try reopening the app"* with a console error:

```
StorageController.statistics: unknown key "currentStreakAnchorPuzzleNum"
```

That specific bug is already fixed (the client's `statistics` schema in
`src/storage-controller.js` now knows about
`currentStreakAnchorPuzzleNum`, and that toast is now dismissible with an X
instead of disappearing on its own). These scenarios are for manually
re-confirming the fix and probing the surrounding streak/sync logic that's
easy to regress, since none of it is covered by browser-driven e2e tests
today.

Each file is a full local-storage snapshot in the same shape as Tools ->
**Download Backup**, so it can be loaded with Tools -> **Restore from
File**. `gameState` (today's in-progress board) is deliberately omitted from
every file -- restoring just leaves "today" unplayed, which is what you want
when the point of the scenario is history/stats sync, not the board itself.

## Regenerate before every session

`puzzle_num` is a fixed function of calendar date (`PUZZLE_EPOCH` in
`api/lib/left_wordle/game.rb`), so a fixture's dates and puzzle numbers only
line up with the app's real "today" on the one date they were generated
for. The `scene_*.json` files in this directory are **generated output** --
don't hand-edit them. The source of truth is `manual_testing/templates/*.template.json`,
where each history entry stores `daysAgo` (an offset from "today") instead
of a literal date/puzzle_num.

Before each testing session, regenerate the fixtures for the day you're
actually testing on:

```
node manual_testing/generate.js
```

This anchors "today" to the real current date. To target a specific date
instead (e.g. to reproduce a report filed on a particular day), pass
`--today`:

```
node manual_testing/generate.js --today=2026-09-01
```

Regenerating recomputes every `puzzle_num`, `date`, `completed_at`, and
`updated_at` (and the `legacy_stats` date fields in scenario 4) from the
`daysAgo` offsets -- nothing else about the fixtures changes.

## One-time setup

1. Run the app against a **staging or local dev API**, never production --
   these scenarios create real throwaway accounts.
2. Have 3-4 browsers (or browser profiles) available per scenario -- e.g.
   Chrome, Firefox, Safari, and a Chrome guest/incognito-adjacent profile.
   Passkeys don't sync across different browser vendors on the same
   machine, so joining "browser B" to "browser A"'s account has to go
   through **Tools/Login -> Add a Device (Link)**, not a plain login. That
   link-based join is also the exact code path the staging bug hit
   (`registerViaDeviceLink` -> `syncAndAnnounce` ->
   `syncFromServerAndOverwriteLocal`), so it's the right mechanism to test
   with anyway.
3. Open devtools -> Console in every browser before you start, so you catch
   any repeat of the `unknown key` error (or any other console error)
   immediately, not just the toast.

## Procedure (repeat per scenario)

1. **Browser A**: open the app fresh (clear site data first if it's been
   used before). Open Tools -> Restore from File, choose
   `scene_N_browser_a.json`, confirm the overwrite. The page reloads.
2. Still in Browser A: open the login overlay and **Create Account**
   (register a brand-new passkey). This pushes A's restored local data up as
   a new account (`pushLocalDataToNewAccount` in `src/login_ui.js`) --
   preferences, a one-time game-state push, and every history entry from
   the file. Watch for the toast; note whether it reports success or a
   discrepancy.
3. In Browser A, open **Add a Device (Link)** and copy the generated URL.
4. **Browser B**: open the app fresh, restore
   `scene_N_browser_b_*.json` the same way as step 1 -- this seeds B with
   its *own* pre-existing local data, matching "logged in from a different
   browser with some history."
5. Still in Browser B, paste in the device-link URL from step 3 and
   complete passkey setup. This calls `registerViaDeviceLink` then
   `syncAndAnnounce`, then reloads. B's local history and stats are *not*
   overwritten and *not* merged -- B simply starts reading the account's
   data from the server (see `docs/online_play_redesign.md`); the one thing
   that does get written into B's local storage is the account's
   preferences. **Watch this step closely** -- it's the exact repro path for
   the original bug and the main thing each scenario below is designed to
   reveal. After the reload, B should be showing the account's in-progress
   game and the account's settings, not its own.
6. If a scenario has a `browser_c` (or `browser_d`) file, repeat steps 3-5
   using Browser A's (or the most-recently-linked device's) "Add a Device"
   link to bring it in too.
7. After each device joins, check: the toast text, the console, the Stats
   screen (`currentStreak` / `maxStreak` / games played), and the History
   list. Cross-check against "what to look for" below.

You can re-run a scenario by discarding the throwaway account (or just
starting a new one each time -- registration is cheap in dev/staging).

---

## Scenario 1 -- stale streak reconnects across devices

`scene_1_browser_a.json`, `scene_1_browser_b_adds_to_stale_streak.json`,
`scene_1_browser_c_adds_history_no_stats.json`

This is the literal bug report, broken into pieces:

- **Browser A** has a 30-game streak that goes stale **4 days before
  "today"**. Registering it establishes the account with
  `currentStreakAnchorPuzzleNum` pinned at that puzzle.
- **Browser B** independently played exactly the **3 days A's streak went
  stale for** (3, 2, and 1 days before "today") before ever linking to the
  account. Linking it is where the original bug fired.
- **Browser C** has only a single history entry for "today" and **no local
  `statistics` key at all** -- the cleanest possible repro of the schema
  bug, since this browser's `StorageController.statistics` has never held
  a `currentStreakAnchorPuzzleNum` before and must accept the server's
  value cold.

**What to look for:**
- Linking Browser B must not reproduce the console error or the
  undismissable-toast bug. If it fails, the toast should stay on screen
  with a visible X until closed.
- Compare intent vs. implementation: `docs/migration_rethink.md` states
  that adding a device should "add missing played_games from the device's
  history" (server wins only on conflicts). The actual code
  (`syncFromServerAndOverwriteLocal`) does a pure pull-down with no
  push-up of B's pre-existing history. So: **does B's 3-day contribution
  survive linking, or does it silently vanish**, leaving the account's
  streak still anchored at A's stale puzzle? Confirming which one actually
  happens (and flagging it if it's the silent-data-loss version) is the
  main point of this scenario.
- After Browser C links, its Stats screen should show the server's
  numbers with no console error -- this is the direct regression test for
  the shipped fix.

## Scenario 2 -- clean device link, no local conflicts

`scene_2_browser_a.json`, `scene_2_browser_b_no_history_or_stats_added.json`

The control case. Browser A has a **live** streak (still active as of
yesterday, not stale). Browser B contributes nothing -- no `history`, no
`statistics`, just prefs/device id. Run this one **first**, before
Scenario 1, as a sanity check: with zero local data to conflict with, the
sync-down after linking has nothing to negotiate, so it's the simplest
possible pass/fail signal for whether the core fix works at all.

**What to look for:**
- Browser B ends up with A's exact preferences, history, and stats after
  linking, with no console error and no failure toast.

## Scenario 3 -- a streak gap freezes, and a later backfill can't repair it

`scene_3_browser_a.json`, `scene_3_browser_b_creates_gap.json`,
`scene_3_browser_c_backfills_the_gap.json`

Exercises the server's contiguity rule directly
(`apply_played_game_to_statistics!` in `api/app.rb`): a played-games row
only moves the streak/anchor if its `puzzle_num` is exactly `anchor + 1`.
Anything else is preserved in history but archival only.

- **Browser A**: streak ends 4 days before "today".
- **Browser B**: after linking, plays only **today** -- skipping the 3
  days in between entirely.
- **Browser C**: supplies exactly the **3 missing days** (3, 2, and 1 days
  before "today"), but only *after* Browser B has already moved the
  server's anchor to today's puzzle.

**What to look for:**
- After Browser B links/syncs: `gamesPlayed` goes up by 1, but
  `currentStreak` and the anchor must **not** advance to include today's
  puzzle as a streak continuation -- the Stats screen should still show A's
  original streak length, not +1. The History list should still show
  today's puzzle as played.
- After Browser C links/syncs: the 3 backfilled days should appear in
  History, but since they land *behind* an anchor that's already past
  them, they must **not** retroactively repair or extend the streak. This
  is the sharp, easy-to-get-wrong case: chronologically filling a gap is
  not the same as the server treating it as contiguous. If the streak
  jumps up after this step, that's a bug.

## Scenario 4 -- legacy aggregate totals vs. real per-puzzle history

`scene_4_browser_a.json`,
`scene_4_browser_b_legacy_totals_no_history.json`

Exercises the discrepancy-detection toast and the manual **Adjust Stats**
flow (`stats_adjust_response` in `api/app.rb`, which keeps a before/after
audit row in `stats_adjustments`).

- **Browser A**: normal, fully-migrated account with ~47 real history rows.
- **Browser B**: represents an old, never-fully-migrated device. It only
  has **4 real history rows** (the last 4 days), but carries a
  `legacy_stats` blob claiming **412 games played** -- the old rolled-up
  aggregate from before per-puzzle history tracking existed. Note this
  file has no `statistics` key of its own, only `legacy_stats`.

**What to look for:**
- Linking Browser B should push its 4 real history rows, and since 412 is
  far more than what those rows (plus whatever A already contributed)
  could ever reconstruct, the app should surface the "this backup shows
  more games played than could be matched to specific puzzles -- use
  Tools > Adjust Stats" toast rather than silently trusting either number.
- Walk through Tools -> **Adjust Stats manually**, enter totals that
  reconcile the two, and apply. Confirm the Stats screen reflects the
  manual totals immediately, and that this doesn't get silently
  overwritten by a later sync from another device (per
  `next_statistics_for`, manual adjustments aren't derived from
  played_games events, so they persist until the next real played-game
  event moves them).

---

## Notes on the fixtures themselves

- `device_id` per file is a fixed, deterministic UUID (derived from the
  filename) so it's stable across re-runs and easy to recognize in
  devtools/API responses.
- `version` is set to the current `window.APP_VERSION` so restoring a file
  doesn't trigger an incidental `settingsBackup` snapshot.
- History entries alternate a small guess-count cycle (3/3/4/3/2) purely
  for a plausible-looking guess distribution -- the exact counts aren't
  meaningful.
- `result` follows the local history convention: `1`-`6` is a WIN in that
  many guesses; anything outside that range is a FAIL. None of these
  fixtures include a FAIL entry today, but you can hand-edit one into a
  **template** (set `result` to e.g. `7`) if you want to test the "fail
  resets currentStreak but keeps maxStreak" rule too, then re-run
  `generate.js`.
- Each template's history entries carry `daysAgo` instead of a literal
  date -- `generate.js` resolves those against whatever "today" you
  generate for into concrete `date`/`puzzle_num`/`completed_at`/
  `updated_at` values. If you need to add or reshape a scenario, edit the
  `.template.json` file, not the generated `scene_*.json` -- the latter is
  overwritten on every run.
