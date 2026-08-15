# Migration Rethink / Online Play / Re-sync After Offline Period
## Principles

1. Nothing done, planned, or discussed with respect to migrating and maintaining a user's data on my server is assumed correct or the best way to handle things.
1. We must do everything possible to preserve existing information whenever we move or alter it in any way.
1. Once registered, the server data becomes the source of truth.

## Initial Registration
1. Is it worth creating the passkey first, logging the user out, and then going through the login flow with the just created Passkey to verify that the user can successfully log in with their Passkey? (We will be dealing with users for who may never have heard of Passkeys before). If so, we need to set a flag on their account to indicate it was created but not yet migrated.
1. We add a row to storage_snapshots prior to anything else, user_id, and client_device_id are populated, event is "new user creation" and local_storage is a hash object that copies as json the user's local storage.
1. a row is added to user_profiles and their preferences, game_state, and statistics are populated.
1. All history files are added to the played_games table. If we don't have all the guesses, use the starter word for guess 0. Also use the answer for the last guess if the status in WIN, any guesses we don't know get set to null. (if solved in 3, no null for array pos 3, 4, 5 just 0, 1, & 2) 

## Device / Browser Added to Online Account

**Superseded by `online_play_redesign.md`.** The merge described below (pull
server data down, push the device's missing history up) was never fully
built and manual testing confirmed it silently drops data — see that doc
for the replacement: two non-merging modes (offline/online) instead of a
device-added reconciliation step. Left here for history.

1. We add a row to storage_snapshots prior to anything else, user_id, and client_device_id are populated, event is "new device added" and local_storage is a hash object that copies as json the user's local storage.
1. local storage preferences from the device are ignored (server is truth)
1. we make note of the last played game for this user on the server, their stats and streaks are also noted from the server (these are the current rows for that user on the server, for the played games it is the played game with the highest puzzle_num)
1. now we add missing played_games to the server from the device's history local storage -server always wins. if the game exists on both we leave server paled_games for that puzzle number untouched
