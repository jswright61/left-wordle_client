# Local Storage Backup

There are two independent mechanisms for backing up local storage: an automatic snapshot taken on each app version bump, and a manual export the user can trigger from the Tools panel.

---

## Automatic Version Snapshot

On every page load, `index.html` fires a `window` `load` listener that calls:

```javascript
StorageController.settingsBackup.maybeBackup(window.APP_VERSION)
```

`APP_VERSION` is a date-stamped build string set in `app_version.js` (e.g. `"2026-02-13_001"`).

`SettingsBackupStorage.maybeBackup` (in `storage-controller.js`) does the following:

1. Reads the current contents of the `settingsBackup` localStorage key.
2. If a snapshot already exists for this version (keyed as `v<version>`), it returns immediately — so each version is snapshotted at most once per device.
3. Otherwise, it walks every key in `localStorage`, copies each raw value into the snapshot, and writes the result back under `settingsBackup`.

The snapshot excludes `settingsBackup` itself (to avoid nesting). Each version entry looks like:

```json
{
  "v2026-02-13_001": {
    "ts": "2026-02-13T14:00:00.000Z",
    "statistics": "{ ... }",
    "history": "{ ... }",
    ...
  }
}
```

Multiple versions accumulate in the same `settingsBackup` key. There is no automatic pruning.

`StorageController.settingsBackup.get()` returns the full backup object (all versions), or `null` if nothing has been written yet.

---

## Manual Export — "Download All Settings"

The "Download All Settings" button in the Tools panel calls `ToolsMenu#collectAllSettings` (in `toolsmenu.js`), which:

1. Walks every key in `localStorage` and parses each value as JSON (falls back to the raw string if parsing fails).
2. Appends a `diagnostics` key with `{ server, version }` metadata.
3. Returns the assembled object.

`wireTroubleshootingSection` then passes that object to `ToolsMenu.createDownload`, triggering a browser download of the JSON file named `left_wordle_settings_<date>.json`.

This export includes everything in localStorage at that moment, including the `settingsBackup` snapshots.

---

## Manual Export — "Send Settings to Developers"

The "Send Settings to Developers" button follows the same path as Download — it calls `collectAllSettings` — but instead of a browser download, it POSTs the payload to `POST /api/v1/diagnostics` via `LeftWordleApi.client.submitDiagnostics`.

The API emails the payload as a `.json` attachment to the Left Wordle support address. If the server's SMTP is not configured, the API returns 503 and the client tells the user to use "Download All Settings" instead.

See `api/docs/mail_setup.md` for server-side SMTP configuration.

---

## Key Relationships

| Piece | Where | Role |
|-------|-------|------|
| `SettingsBackupStorage` | `storage-controller.js` | Storage class; holds `maybeBackup`, `get`, `clear` |
| `StorageController.settingsBackup` | `storage-controller.js` | Singleton instance wired into the app |
| Backup trigger | `index.html` (`window` `load` listener) | Calls `maybeBackup` once per page load |
| `APP_VERSION` | `app_version.js` | Build string used as the version key |
| `ToolsMenu#collectAllSettings` | `toolsmenu.js` | Assembles full localStorage snapshot for manual export |
| `ToolsMenu#wireTroubleshootingSection` | `toolsmenu.js` | Wires Download and Send buttons |
| `LeftWordleApi.client.submitDiagnostics` | `api_client.js` | POSTs the payload to the API |
