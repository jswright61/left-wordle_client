# Missed Days Do Not End Streaks

Missing a day will no longer end a player's streak; only finishing a puzzle
without solving it will. This becomes the default for everyone. Existing
players see a one-time announcement that lets them keep the old rule.
Designed 2026-10-10, **deferred**. Not built.

## Why

A streak that ends when a day is missed creates pressure to keep it going,
often more than subtle pressure, and the longer the streak, the more pressure
there is. For a game, that's the wrong trade. A streak should be something a
player enjoys, not something they feel they have to protect.

That's why this is a new default for everyone rather than an opt-in buried
in Preferences. Players who prefer the old rule keep it with one choice.

## Status and timing

Deferred out of `v1.0.5`. It will ship either with Phase 3 of the ownership
rework (`api/docs/ownership_rework.md`) or as a standalone feature release
after Phase 3.

Reasons for deferring:

- **Size.** About a day's work with tests. It touches the most sensitive
  code in the app, statistics, in both repos.
- **Phase 3 overlap.** The server's streak rule lives in
  `next_statistics_for`, called from `apply_played_game_to_statistics!`.
  Phase 3 rewrites the code around both (the dual-read and canonical
  lookup). Building this after the phase branches are rebased onto
  `develop` avoids one more conflict in that code.
- `v1.0.5` was already large.

## The rule

The only difference is what counts as continuing a streak.

| | Win | Loss |
|---|---|---|
| **Missed days ignored** (new default) | Always continues the streak, whatever the gap | Streak goes to 0 |
| **Missed days end streaks** (old rule, opt-in) | Continues the streak only if it's the next puzzle after the last one completed; a gap starts a new streak of 1 | Streak goes to 0 |

"Missed day" means a gap in puzzle numbers, which is how both the client and
the server already measure continuity. It doesn't depend on timestamps or
time zones.

Max streak follows current streak as it does today.

## The preference

**Missed days end streaks**, off by default.

- *Enabled:* Missing a day or completing a puzzle without solving it ends
  your streak.
- *Disabled:* Only completing a puzzle without solving it ends your streak.
  Missed days are ignored.

Placement is still open: next to Hard Mode, or in a new "Statistics" group
in Preferences.

### One default, everywhere

**A missing value means off (missed days ignored)**, on the device and on
the account. Only players who choose the old rule have the preference
stored as on.

That single default is what makes this simple. An earlier version of this
design defaulted new players off and existing players on, which needed a
per-device decision about who counts as existing. That broke down at sign-in:
`mergeFromServer` only overwrites keys the account has, and a preferences
sync pushes the device's whole blob, so a new device could silently switch
an existing account's rule. With one default there's nothing to clash.

Switching the preference in Preferences applies from the next game. It
never changes the current streak by itself (see "Stats are never
recalculated" below). A player who wants a different number uses Tools >
Adjust Stats, which already exists for this.

## The announcement

Existing players see a one-time modal explaining the change, with a choice.
New players don't see it: they start with the new default, and the
preference is in Preferences for anyone who looks.

### Copy

> **Missed days no longer end your streak**
>
> Starting today, only finishing a puzzle without solving it ends your
> streak. Missing a day doesn't. A streak should be something you enjoy, not
> something you feel you have to protect, and that pressure only grows the
> longer the streak gets.
>
> If you'd rather keep the old rule, choose it below. You can change this any
> time in Preferences.
>
> **[Keep the new rule]**   [Missed days end my streak]

- **Keep the new rule** (primary): leaves the preference off.
- **Missed days end my streak**: turns it on, so everything continues as
  before.
- No ✕ and no click-outside dismissal: the modal needs one of the two
  answers, so its "seen" flag is never set without a choice.

### Who sees it

An **existing player** is one with a completed game from before the release.
Defining it by the release, not just "has played", means a new player
never qualifies later, after their own first game. Nothing has to be written
for new players either, which keeps the sign-in problem above from coming
back.

- Mark the release with a constant: the puzzle number of the release day,
  set in the release commit.
- **Signed out:** the device has a history entry with a puzzle number before
  the release puzzle, or has statistics (`gamesPlayed > 0`) with no history
  at all (pre-history devices).
- **Signed in:** the same test against the account's data. History isn't
  fetched at load today, so settle the data source when building (see Open
  questions).

### Once per player, not per device

Answering either way writes a "seen" flag as a preference. Preferences sync
to the account, so:

- A signed-in player answers once, and their other devices pick up the flag
  when they load.
- A signed-out device asks once for itself.

### Shown before play

The modal appears at load, before the player can enter a guess, so their
answer is in place before their next game is recorded.

### Old gaps

A player whose last game was a few days before the release still has that
streak saved. Under the new rule their next win **continues** it rather than
restarting at 1. That's deliberate: it's what "missed days are ignored"
means, and it's a small kindness. A player who wants that gap to count
chooses "Missed days end my streak", and the gap breaks the streak as
before.

## Stats are never recalculated

Stats change only from a live completion or the player's own manual
adjustment, never from a recalculation; a past recompute-from-history
approach caused real data loss (`client/docs/migration_rethink.md`). This
design keeps to that:

- Neither the release, the announcement, nor a change in Preferences
  touches the current or max streak. The rule only decides whether a
  **future** win continues the streak.
- There's no "what your streak would have been" calculation anywhere. It
  would be the recalculation the rule exists to prevent, and history is often
  incomplete anyway (pre-history aggregates, imports without guesses).
- Players who want a different number use Adjust Stats, which is recorded as
  a manual adjustment.

## Implementation notes

### Client

- **Streak continuity:** `HistoryManager.isContinuingStreak(dayOffset)`
  decides `isStreak`, which `StatisticsEngine.updateStatistics` uses. With
  the preference off, a win continues the streak if there's any earlier
  completion, whatever the gap.
- **Preferences:** add two keys to the preferences schema in
  `storage-controller.js` and to `DEFAULT_PREFERENCES` in `wordle.js`: the
  rule (off by default) and the announcement's "seen" flag. Missing means
  off for both.
- **Announcement:** a modal at load, after account preferences are applied
  (`applyAccountPreferences`) so a signed-in player's flag from another
  device is already in place.
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
  continues" unless the account has the preference on. Loss resets, max
  streak and the anchor update are unchanged.
- The server reads the preference from `user_profiles.preferences` inside
  the transaction in `apply_played_game_to_statistics!`, which already locks
  the profile row. A missing key means off.
- **API contract:** the server has never interpreted anything inside the
  preferences blob, so this is a contract change. Document the key in
  `api/docs/api_interface.md`.
- History imports go through the same function, so the account's current
  preference applies to imported rows too. That's consistent with "from the
  next game": the import happens now.

### Deploy order

api first, then client, as usual. Once the api is live, the new rule applies
to every signed-in completion, including from browsers still on the old
client that haven't shown the announcement. In that window the change only
ever goes the kind way: a win after a gap continues a streak instead of
restarting it. The window is the time between the two deploys, plus however
long old clients linger, and needs no handling.

Signed-out devices on the old client keep the old rule locally until they
load the new code.

### Multi-device race

The preference is account-wide. If a player switches it on device A and
finishes a game on device B before A's preferences push lands, that one
completion uses the previous rule. That's acceptable, and Adjust Stats fixes
the number if they care. Don't build anything for it.

## Release notes

Under "Everyone":

> Missed days no longer end your streak: only finishing a puzzle without
> solving it does. Prefer the old rule? Turn on "Missed days end streaks" in
> Preferences.

## Tests

- **Client unit:** the continuity rule both ways (gap and win, gap and loss,
  consecutive); missing preference behaves as off; the existing-player test
  (history before the release puzzle, pre-history stats with no history, a
  new player who has played since the release).
- **API:** `next_statistics_for` with the preference on, off, and missing
  (behaves as off).
- **e2e:**
  - An existing player sees the announcement, a new player doesn't.
  - Either button sets the flag, and it doesn't show again.
  - "Missed days end my streak" turns the preference on.
  - With the preference off, a win after a skipped puzzle continues the
    streak; with it on, it restarts at 1.
  - Switching in Preferences leaves the current streak unchanged.

## Open questions

1. Placement in Preferences: next to Hard Mode, or a new "Statistics" group.
1. Signed-in existing-player test: where the data comes from at load. The
   account's statistics are already loaded (`cachedProfile`), but statistics
   alone can't tell a game before the release from one after. Options: fetch
   history when the flag is unset, or have the server report the account's
   earliest completed puzzle number.
1. Release vehicle: with Phase 3, or standalone after it.
