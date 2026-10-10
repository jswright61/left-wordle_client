# Missed Days Do Not End Streaks

A preference that lets a player choose whether missing a day ends their
streak. Designed 2026-10-10, **deferred**. Not built.

## Status and timing

Deferred out of `v1.0.5`. It will ship either with Phase 3 of the ownership
rework (`api/docs/ownership_rework.md`) or as a standalone feature release
after Phase 3.

Reasons for deferring:

- **Size.** Roughly a day's work with tests. It touches the most sensitive
  code in the app, statistics, in both repos.
- **Phase 3 overlap.** The server's streak rule lives in
  `next_statistics_for`, called from `apply_played_game_to_statistics!`.
  Phase 3 rewrites the code around both (the dual-read and canonical
  lookup). Building this after the phase branches are rebased onto
  `develop` avoids one more conflict in that code.
- `v1.0.5` was already large.

## Preference copy

**Missed days end streaks**

- *Enabled:* Missing a day or completing a puzzle without solving it ends
  your streak.
- *Disabled:* Only completing a puzzle without solving it ends your streak.
  Missed days are ignored.

Placement is still open: next to Hard Mode, or in a new "Statistics" group
in Preferences.

## The rule

The only difference is what counts as continuing a streak.

| | Win | Loss |
|---|---|---|
| **Enabled** (today's behaviour) | Continues the streak only if it's the next puzzle after the last one completed; a gap starts a new streak of 1 | Streak goes to 0 |
| **Disabled** | Always continues the streak, whatever the gap | Streak goes to 0 |

"Missed day" means a gap in puzzle numbers, which is how both the client and
the server already measure continuity. It doesn't depend on timestamps or
time zones.

Max streak follows current streak as it does today.

## Defaults: disabled for new players, enabled for existing ones

The plan is to default the preference to **disabled for new players**.
Existing players default to **enabled**, because flipping their rule would
be an unexpected change to their stats.

This means the default can't be one value in `DEFAULT_PREFERENCES`. It has
to be decided once, written explicitly, and never inferred again:

- **Device, first load after release:** if the preference is unset and the
  device has any history or statistics (`gamesPlayed > 0` or a non-empty
  history), write **enabled**. Otherwise it's a new player: write
  **disabled**.
- **Server:** a missing key in an account's preferences means **enabled**.
  Every account that exists before this ships lacks the key, so missing must
  mean "today's behaviour".

### The sign-in trap

`StorageController.preferences.mergeFromServer` only overwrites keys the
account actually has, and a preferences sync pushes the device's whole
blob (`putPreferences(getAll())`). So:

1. An existing account holder (no key on the account, so enabled) opens the
   site on a new device.
1. The device has no history, decides they're a new player, and writes
   **disabled**.
1. They sign in. The account has no key to overwrite it with, and the next
   preferences push writes **disabled** to the account, silently changing
   an existing player's rule.

That must not happen. Options, to settle when building:

- On sign-in, an account with no key gets **enabled** written locally
  before any push, so the account's (implicit) value wins over the
  device's guess. This is probably the right one.
- Or write the key to every existing account in a one-off migration
  (`enabled`), so the account always has an explicit value. Mind the stats
  immutability rule: this only writes a preference, not stats, so it's
  allowed. But it's a data migration on `user_profiles`, so it needs the
  usual expand/contract care.

A new account created from a new device keeps the device's **disabled**,
which is the intended new-player default.

## Changing the preference: the dialogue

Stats change only from a live completion or the player's own manual
adjustment, never from a recalculation; a past recompute-from-history
approach caused real data loss (`client/docs/migration_rethink.md`). So switching the
preference **does not touch the current streak by itself**. It applies going
forward only.

Instead, every change of the preference opens a small modal asking the player
what their current streak should be. Their answer is a manual adjustment.

- A number field filled in with the current streak, and two buttons:
  **Keep N** and **Set**. Closing the modal any other way means keep.
- Suggested copy: *"Your current streak is 12. Keep it, or set a new
  number."*
- Not "press Enter": phones play with the on-screen keyboard, which has no
  Enter key for this.
- **Max streak:** if the new number is above the max streak, the max rises to
  match (Adjust Stats already requires max ≥ current). Say so in the modal
  rather than change it silently, e.g. *"Your max streak will also become
  15."*
- **Show it on every change**, both directions. It's cheap, and it keeps the
  number in the player's hands.
- **Don't suggest a number.** Calculating "what your streak would be under
  the new rule" from history is the recalculation the stats rule exists to
  prevent, and history is often incomplete (pre-history aggregates, imports
  without guesses).
- **Turning the rule on after missed days:** a kept streak still shows N,
  but under the stricter rule it ends at the next game after a gap. The
  modal is the player's chance to set it to what they think is fair.

### Recording the adjustment

- **Signed in:** go through the same path as Tools > Adjust Stats
  (`stats_adjust_response`), so the server's `stats_adjustments` audit row
  has source `manual`. Don't add a new source label unless the audit trail
  needs to distinguish "set on preference change" from Adjust Stats. If it
  does, add it to `STATS_ADJUSTMENT_SOURCES`; that's a permanent label.
- **Signed out:** use the same local mechanism Adjust Stats uses.

## Implementation notes

### Client

- **Streak continuity:** `HistoryManager.isContinuingStreak(dayOffset)`
  decides `isStreak`, which `StatisticsEngine.updateStatistics` uses. With
  the preference disabled, a win continues the streak if there's any earlier
  completion, whatever the gap.
- **Preference:** add the key to `StorageController`'s preferences schema
  (`storage-controller.js`) and `DEFAULT_PREFERENCES` in `wordle.js`. Note
  the default-at-first-load logic above: the key's absence must be resolved
  once, not read through a default.
- Check anything else that reads streak continuity, e.g. the "streak at
  risk" calculation near `todayCompletion` in `wordle.js`, and the
  `terminatedStreak` handling that restores a streak.
- `recomputeAndPersistStatistics` and the history-based stats functions
  aren't on the normal play path (only debug and test exports), so they don't
  need the rule. If that ever changes they will: a recompute can't know which
  rule was active when.

### API

- `next_statistics_for` in `app.rb`:
  `is_continuation = anchor && puzzle_num == anchor + 1` becomes "any anchor
  continues" when the account's preference is disabled. The rest (loss
  resets, max streak, anchor update) is unchanged.
- The server reads the preference from `user_profiles.preferences` inside
  the transaction in `apply_played_game_to_statistics!`, which already locks
  the profile row. Missing key means enabled.
- **API contract:** the server has never interpreted anything inside the
  preferences blob, so this is a contract change. Document the key in
  `api/docs/api_interface.md`.
- History imports go through the same function, so the account's current
  preference applies to imported rows too. That's consistent with "going
  forward": the import happens now.

### Deploy order

api first, then client. Same as the usual order: the server must honour the
preference before any client can set it, or a signed-in player who turns it
off would still see the server break their streak.

### Multi-device race

The preference is account-wide. If a player turns it off on device A and
finishes a game on device B before A's preferences push lands, that one
completion uses the old rule. That's acceptable, and the player can fix the
number with Adjust Stats. Don't build anything for it.

## Tests

- **Client unit:** the continuity rule both ways (gap and win, gap and loss,
  consecutive); first-load default for an empty device versus a device with
  history; the sign-in case where the account has no key.
- **API:** `next_statistics_for` with the preference enabled, disabled, and
  missing (behaves as enabled); the adjustment from the dialogue recorded as
  `manual`.
- **e2e:** toggling opens the dialogue; Keep leaves stats unchanged; Set
  changes current streak and raises max when needed; with the preference
  disabled, a win after a skipped puzzle continues the streak.

## Open questions

1. Placement in Preferences: next to Hard Mode, or a new "Statistics" group.
1. Sign-in trap: which fix (write enabled on sign-in when the account has no
   key, or a one-off migration).
1. Whether the dialogue's adjustment needs its own audit source label.
1. Release vehicle: with Phase 3, or standalone after it.
