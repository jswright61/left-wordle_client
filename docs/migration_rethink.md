# Migration Rethink / Online Play / Re-sync After Offline Period

## Principles

1. Nothing done, planned, or discussed with respect to migrating and maintaining a user's data on my server is assumed correct or the best way to handle things.
1. We must do everything possible to preserve existing information whenever we move or alter it in any way.
1. Once registered, the server data becomes the source of truth.

## Clarification: there is no sustained "offline play"

The client has no local answer list — each day's answer must come from the server.
"Offline" anywhere in this document means *sync/report calls failing after that day's
answer was already fetched*, bounded to roughly a session's length (a phone losing
signal mid-game, a brief connectivity gap), not an extended multi-day disconnected
period. "Logged out" (anonymous play) is a separate, already-supported concept and is
unaffected by anything below.

## Initial Registration

1. Skip the passkey verify-login round trip. The WebAuthn registration ceremony itself
   (`register_finish_response`) already proves the authenticator works — no forced
   logout/relogin, no "pending/not yet migrated" account flag.
1. Immediately after a brand-new registration (not a device-link join —
   `login_ui.js`'s `pushLocalDataToNewAccount`), the client pushes a row to
   `storage_snapshots` prior to anything else: `user_id` and `client_device_id`
   populated, event `"new user creation"`, `local_storage` a raw dump of the client's
   entire local storage (`StorageController.dumpRaw()`), via
   `POST /api/v2/profile/local_storage_snapshot`. Audit-trail only — never treated as a
   source of truth for anything below.
1. Preferences, a one-time game_state snapshot, and full history all push next, in
   parallel (`syncPreferences`, `syncGameStateOnce`, `syncHistoryEntries`). History
   entries land in the `played_games` table exactly like every other import: if we
   don't have all the guesses, use the starter word for guess 0, the answer for the
   last guess if the status is WIN, and null for anything unknown in between (solved in
   3 → no null at array pos 0–2, just those three).
1. **Statistics are never pushed as a blob, including at registration** — retired along
   with `PUT /api/v2/profile/statistics` (see Online Play Sync below). Instead
   `gamesPlayed`/`gamesWon`/streak are derived the same way as every other scenario in
   this doc: incrementally, from the `played_games` rows the history push above just
   created. The one gap this can't close — a local total that includes legacy
   aggregate-only data with no corresponding history entry — is surfaced rather than
   silently trusted: `LeftWordleAuth.statsDiscrepancyAfterPush` compares the client's
   locally-computed `gamesPlayed` (`StatisticsEngine.computeStatisticsFromHistoryAndLegacy`)
   against what the server actually derived, and if the local figure is higher, the
   user is pointed at the existing manual "Adjust Stats" flow instead of the gap being
   auto-applied. Identical in spirit to how the restore-from-backup flow handles the
   same problem.

## Device / Browser Added to Online Account, and Re-sync After Offline Period

These are the same underlying problem — *the server is missing `played_games` rows a
device has* — and share one merge algorithm. They differ only in which direction
preferences/game_state trust flows.

1. We add a row to `storage_snapshots` prior to anything else, `user_id` and
   `client_device_id` are populated, event is "new device added" (or "re-sync after
   offline" for an already-linked device) and `local_storage` is a hash object that
   copies as json the user's local storage.
1. **Preferences / game_state trust direction:**
   - *Device newly added to an existing account*: local storage preferences from the
     device are ignored — server is truth. They're pre-migration cruft with no claim to
     being current.
   - *Already-linked device re-syncing after offline*: the reverse. This device's local
     prefs since its last sync are the newest expression of intent that exists
     anywhere — they push up and overwrite the server.
1. We add any missing `played_games` rows from the device's local history — server
   always wins on conflict for the same `(client_device_id, date)` (existing
   `import_history_row!` upsert behavior: `coalesce(existing, incoming)` for
   `game_status`/`guesses`/`completed_at`).
1. **Streak/stats only move via a persisted anchor, never a recompute.** Track
   `currentStreakAnchorPuzzleNum` alongside `currentStreak` in `user_profiles.statistics`.
   A newly inserted row only affects stats if it's a WIN landing at exactly
   `anchor + 1`:
   - `currentStreak += 1`, `anchor += 1`, `maxStreak = max(maxStreak, currentStreak)`
     (monotonic — never decreases).
   - `gamesPlayed` / `gamesWon` / the guess-count histogram increment by exactly that
     row (additive, not a replay).
   - A FAIL at `anchor + 1` resets `currentStreak` to 0 and still advances the anchor.
   - Anything landing **behind** the anchor (older backfill, arrives out of order) is a
     no-op for stats regardless of arrival order — archival only. It's visible in
     `played_games`/history but never touches the numbers.

   This is what makes the whole thing safe under arbitrary multi-device insert
   ordering, and avoids the "recompute stats from `played_games`" data-loss failure
   mode the `user_profiles` schema comment already warns about (history can be
   incomplete or lag behind stats — a full recompute would drop legacy aggregate data
   that has no corresponding row).
1. **No dedicated "offline" state machine is needed.** Every write (`syncPreferences`,
   `syncHistoryEntry`, `_fireCompletionReport`) is retry-on-failure with a small local
   pending-queue flushed on the next successful call, instead of silently swallowing
   failures. Re-sync falls out of retrying normal writes; there's no reconnect
   handshake to build.

## Multi-Device Same-Puzzle Conflict

Two devices can independently produce a `played_games` row for the same `puzzle_num`
(the unique index is `(client_device_id, date)`, not `(user_id, puzzle_num)`).

1. Canonicalize to one row per `(user_id, puzzle_num)` using **first-completed-wins,
   decided by server-arrival order** (`created_at`), not client-reported
   `completed_at` — client clocks are vulnerable to skew, especially after a device has
   been offline. Accepted tradeoff: a genuinely-earlier offline completion can lose to
   a later online completion that happens to report first.
1. Feed that canonical set into the anchor-based streak/stats logic above.
   Canonicalization is a pure function of "the set of rows that exist for this
   puzzle" — order-independent, so it never matters which device syncs first or
   whether both were offline simultaneously.
1. The losing row is **not deleted** — kept for audit / preserve-information, just
   excluded from the canonical set used for stats/streak and from what
   `history_get_response` returns.

## In-Progress `game_state`

No live sync. This is deliberate: in-progress game state (mid-puzzle guesses) is
intentionally not synced live — only settled, completed data is pushed. `game_state`
still transfers as part of a full profile overwrite (registration, device-added,
sync-down), just never mid-game.

## Online Play Sync

Per-guess evaluation, completed-game reporting, and preference sync already push live
today. The one change: statistics are never pushed as a client-computed blob.

1. `syncStatistics` / `put_statistics_response` (full-blob overwrite, no merge) is
   retired. Every completed game already reaches the server as a `played_games` event
   via `/game/complete` or `/history/import` — that event alone drives the anchor-based
   incremental update above, regardless of whether it arrived via live play or
   backfill.
1. The client still computes stats locally for instant UI feedback, but the server
   never trusts that computed number — the client picks up the authoritative value on
   next sync-down (`syncFromServerAndOverwriteLocal`).
1. `stats_adjustments` (the manual "Adjust Stats" flow) is untouched — a deliberate,
   audited, user-initiated override, orthogonal to automatic sync.

## Restore From Backup

`pushRestoredDataToServer` (Tools > Restore Backup, while logged in) pushes three
things after a downloaded backup file is written into local storage:

1. **History** — goes through `/history/import`, the same mechanism as the online-play
   incremental merge above. No special-casing needed.
1. **Preferences** — matches the re-sync-after-offline direction: this device's
   restored state is explicit user intent, pushes up and overwrites server.
1. **Statistics** — no longer pushed as a blob. Once restored history entries flow
   through `/history/import`, the server already derives `gamesPlayed` / `gamesWon` /
   streak incrementally from them.
   - Edge case: a backup old enough to carry legacy aggregate totals with no
     corresponding history entries can't be reconstructed from history import alone —
     the same gap that's why the client's blob is trusted once at registration. Restore
     differs from registration in that the account may already have real, more current
     server state from other devices, so this can't be silently trusted the same way.
   - After the history import completes, compare the restored backup's
     `statistics.gamesPlayed` to the server's newly-derived total. If the restored
     value is higher (a real gap history import couldn't close), surface it to the user
     and let them resolve it through the existing manual "Adjust Stats" flow rather
     than auto-applying it.
