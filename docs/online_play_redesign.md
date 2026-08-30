# Online Play Redesign — Two Modes, No Merge

## Background

`migration_rethink.md`'s "Device / Browser Added to Online Account" section
describes a merge: pull the server's data down, push the device's missing
`played_games` up, server wins on conflicts. That push half was never
built — every login path (`handleSignIn`, `registerViaDeviceLink`) only
ever calls `syncFromServerAndOverwriteLocal`, a pure pull. Manual testing
(see `manual_testing/README.md` Scenario 1) confirmed the result: a second
device's pre-existing local history silently vanishes on login, with no
error, no warning, just gone.

The fix isn't to build the missing push. Trying to reconcile two
independent, possibly-conflicting histories (local storage vs. server) is
where the actual complexity lives — contiguity/arrival-order edge cases,
legacy aggregate totals, orphaned pre-login writes, discrepancy toasts. Each
one is individually reasonable and still adds up to more surprise than any
user is going to read documentation to avoid.

This doc replaces that section of `migration_rethink.md` with a narrower
rule: **local storage and the server are never merged, ever, after account
creation.** A device is either fully offline (local storage authoritative,
exactly today's app) or fully online (server authoritative, local storage
not consulted). Nothing reconciles the two after the fact.

## Principles

1. A device is in exactly one of two modes at any time: **offline** or
   **online**. Never both, never a blend.
2. **Offline** means what it means today: `StorageController` /
   localStorage is the only source of truth. Nothing here changes.
3. **Online** means the server is the only source of truth. Local storage
   is not read for game data, not written to for game data, and never
   pushed or pulled for reconciliation.
4. The only time local data ever moves to the server is **once**, at the
   moment a brand-new account is created on this device
   (`pushLocalDataToNewAccount`). This is unchanged from
   `migration_rethink.md`'s "Initial Registration" section.
5. Every other transition into online mode — plain login, or a device-link
   join to an *existing* account — pulls nothing into local storage and
   pushes nothing from it. It just starts talking to the server directly
   from that point forward.
6. When a device leaves online mode (explicit logout, or a session that's
   no longer valid), it drops straight back to whatever offline state was
   sitting in local storage before it ever went online. That local state
   was never touched while online, so nothing needs restoring — it's just
   still there.
7. If the server can't be reached while a device is online, gameplay
   blocks and retries. It never silently falls back to local storage. See
   "Connectivity loss" below.

## Account creation (unchanged)

Exactly as `migration_rethink.md` already describes: register the passkey,
snapshot local storage to `storage_snapshots` for audit, import preferences
/ game_state / history via the existing one-time push
(`syncNewUserSnapshot`, `syncPreferences`, `syncGameStateOnce`,
`syncHistoryEntries` → `import_history_row!`), surface the legacy-totals
discrepancy toast if the imported history can't account for a larger
locally-known total (Scenario 4 / `stats_adjust_response` /
`stats_adjustments` — all unchanged, all still exercised here and only
here).

This is the one and only point where local data becomes server data.
Everything below assumes it already happened, on some device, at some
point in the past.

## Going online (login, or device-link to an existing account)

No pull. No push. `syncFromServerAndOverwriteLocal` is deleted, not
repaired — there is nothing for it to overwrite, because online mode
doesn't read local storage's game data at all.

What a plain login and an "Add a Device" link now both reduce to is purely
**credential provisioning**: prove you can authenticate as this account,
start a session, done. The only reason "Add a Device" still exists as a
distinct flow is that not every browser has a synced passkey (no 1Password
or equivalent) and needs the QR/link ceremony to create a *new* passkey
credential against an *existing* user — it's about how the credential gets
provisioned, not about migrating data. Once authenticated, both paths land
in the exact same place: online mode, server as truth, nothing local
consulted.

**Required UX moment:** if this device has non-trivial local offline
history at the point it goes online (same discrepancy check already used
at account creation — `statsDiscrepancyAfterPush`'s comparison, or simpler,
just "does local history have entries"), show a one-time, non-blocking
heads-up before or right as the switch happens: *this device's offline
play won't be part of your online account.* Not a merge offer, not a
choice with consequences to weigh — just making sure nobody is surprised
later that a device's local history didn't "come with" them.

## Preferences are the one exception (added after v1.0.3)

Principles 3 and 5 above are about **game data** -- history, statistics,
and the in-progress board. Preferences are explicitly carved out: going
online writes the account's preferences into local storage, server wins per
key, keys only the new device knows about are left alone
(`LeftWordleAuth.applyAccountPreferences` ->
`StorageController.preferences.mergeFromServer`).

The no-merge rule exists because reconciling two independent gameplay
timelines is intractable -- contiguity, streaks, arrival order, legacy
aggregates. None of that applies here. The preferences blob is already
whole-object last-writer-wins server-side (`put_preferences_response`), so
there is nothing to reconcile, and a player signing in on a new device
reasonably expects their settings to come with them rather than silently
reverting to that device's defaults.

Two consequences, both accepted deliberately:

- Preferences persist in local storage after a logout, so an account's
  theme / hard mode stay in effect on a device that has since gone offline.
  Settings are not gameplay data; principle 6 still holds for everything
  else.
- `suppressLoginPrompt` syncs with the rest of the blob. Every login path
  then forces it back to `false` (`resetSuppressedLoginPrompt`), on the
  reasoning that logging in is a positive signal the player wants to play
  online, so a later logout should not go unnoticed.

Applied at session establishment (login) and confirmation (boot) only --
*not* from `syncCompletion`'s `refreshCachedProfile`, which refreshes the
cache after every finished game for the stats counters and would otherwise
be able to revert a local toggle whose push hadn't landed yet.

## Showing the account after going online

Going online mid-session has to reload the page. The board reads the
server's in-progress game only in `GameApp`'s constructor
(`getInitialGameState`), and the `customElements.define("game-app", ...)`
gate waits for the profile only when `wasPreviouslyLoggedIn()` -- which is
false on precisely the device that is signing in for the first time. So
`<game-app>` has already upgraded against local storage by the time the
passkey ceremony finishes. `game-theme-manager` is worse: it is defined
unconditionally and reads `darkTheme` before the profile fetch can have
resolved.

Rather than build a rehydrate-in-place path for a once-per-device moment,
`handleSignIn` and the `joined_existing_account` branch of `handleRegister`
reload after a successful sync, exactly as the device-link flow always has
(it needed a reload anyway to strip `link_token`, which is why that path
showed today's game correctly while plain sign-in did not). On the second
boot `rememberLoggedIn()` has been called, so the gate applies and the
account's game and preferences paint from the start.

A brand-new account does not reload: its local data *is* the account data,
the board is already correct, and `pushLocalDataToNewAccount`'s
stats-discrepancy toast needs to survive long enough to be read.

## Playing online

Every guess and completion goes straight to the server, synchronously,
same shape as today's `/api/v1/game/guess` / `/api/v1/game/complete` calls
(the app already round-trips every guess through the server for anti-cheat
reasons — this isn't new plumbing, it's removing the local-storage side
door that currently runs alongside it for logged-in users). Stats and
history for an online device are `GET /profile` / `GET /history` calls,
not `StatisticsEngine.getStatistics()` / `StorageController.history`.

`apply_played_game_to_statistics!`'s anchor/contiguity rule
(`puzzle_num == anchor + 1`) is unchanged and still needed — not because of
multi-device merging anymore, but because a single online device can still
play catch-up on a missed day out of order, and the rule is what decides
whether that continues the streak. It just no longer has to also referee
arrival-order races between devices, since there's only ever one live
writer (the current puzzle, played once, by the one device that's online
right now).

`gameState` (in-progress board) updates the server after every guess while
online, rather than the current one-time-at-registration-only push. Local
storage may still cache the in-progress board for instant paint on
load/reload, but only as a rendering convenience — on any load, online
mode treats the server's copy as truth and never merges a locally-cached
board into it.

## Connectivity loss while online (not a logout)

Chosen explicitly: **block, don't fall back.** If a guess or completion
call fails because the device can't reach the server, the UI shows a
retry state and the guess stays unsubmitted — it is not saved locally, and
the device does not drop into offline mode on its own. Going offline is
always an explicit state change (logout, or a session the server
considers no longer valid), never an automatic response to a dropped
request. This is the one deliberate tradeoff of this design: an online
device with no connectivity is blocked from playing, not silently
degraded. That's the cost of never needing to reconcile anything.

## Always-visible offline indicator

Any device that has ever logged in must make it obvious when it's
currently in offline mode — a persistent banner/badge, not a toast that
can be missed or dismissed. This is the direct fix for "the app just
looks broken" — a user who's used online play before and lands back in
offline mode (logout, expired session, or declined the login prompt) needs
to know at a glance that they're looking at local history, not their
account's.

## What this removes

- `LeftWordleAuth.syncFromServerAndOverwriteLocal` and its call sites in
  `syncAndAnnounce` (`login_ui.js`).
- The `PENDING_RUNNERS` entries and queueing (`pendingSyncQueue` in
  `auth.js`) for `history`, `historyBulk`, `completion`, and `gameState` —
  there's no more "retry later, reconcile whenever" story for game data
  once a dropped call blocks instead of queuing. (`preferences` and the
  one-time `snapshot` push at registration can keep the simple
  queue-and-retry shape; they're not part of the merge problem.)
- The Scenario 1 / Scenario 3 class of bugs entirely: stale-streak
  reconnects and gap-freezes on reconnect can't happen when a device never
  accumulates offline history while nominally logged in.
- The orphaned-`played_games`-row failure mode (a completion recorded
  before login, `user_id` null, never reattached) — nothing writes
  gameplay data pre-login under this model in the first place; whether the
  pre-login anonymous completion tracking (`record_game_completion!`
  called with `user_id: nil`) is worth keeping at all, purely as
  analytics, is a separate call.

## What stays exactly as-is

- Everything under "Initial Registration" in `migration_rethink.md`.
- `apply_played_game_to_statistics!` and the anchor/contiguity rule.
- Scenario 4's legacy-totals discrepancy toast and the manual **Adjust
  Stats** flow (`stats_adjust_response` / `stats_adjustments`) — both are
  purely about the one-time account-creation import and are untouched by
  anything above.
