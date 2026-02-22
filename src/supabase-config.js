// Supabase configuration for Left Wordle cloud sync.
// Keep sync disabled until schema, auth flow, and UI are fully ready.
window.SUPABASE_SYNC_ENABLED = false;
window.SUPABASE_URL = "https://pxzmjxjbfggbvjwattky.supabase.co";
window.SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB4em1qeGpiZmdnYnZqd2F0dGt5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA0ODg4NjYsImV4cCI6MjA4NjA2NDg2Nn0.7Fh8ygvg2SVOLwCHye1DM0aUH1PBvLcS5-aoCeWsmDA";

// Magic link delivery strategy:
// false: use client.auth.signInWithOtp (Supabase default mail flow)
// true: invoke edge function (supports custom email templates)
window.SUPABASE_MAGIC_LINK_USE_EDGE_FUNCTION = true;
window.SUPABASE_MAGIC_LINK_FUNCTION_NAME = "send-magic-link";
window.SUPABASE_MAGIC_LINK_REDIRECT_PATH = "/sync-resolve";

// Optional rollout override via query string.
// - ?enable-cloud-sync=true|1|on   -> enables and persists to localStorage
// - ?enable-cloud-sync=false|0|off -> disables and persists to localStorage
// - ?enable-cloud-sync=reset       -> clears persisted override
// Special host behavior:
// - staging.left-wordle.com defaults sync ON
// - on staging, only ?enable-cloud-sync=false|0|off turns sync OFF for that page load
(function resolveCloudSyncFlag() {
  var STORAGE_KEY = "cloud_sync_override";
  var QUERY_KEY = "enable-cloud-sync";
  var STAGING_HOST = "staging.left-wordle.com";

  function parseBool(value) {
    var normalized = String(value || "").trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "on") return true;
    if (normalized === "false" || normalized === "0" || normalized === "off") return false;
    return null;
  }

  try {
    var hostname = window.location && window.location.hostname ? window.location.hostname : "";
    var isStagingHost = hostname === STAGING_HOST;
    var params = new URLSearchParams(window.location.search || "");

    if (isStagingHost) {
      if (params.has(QUERY_KEY)) {
        var stagingParsed = parseBool(params.get(QUERY_KEY));
        if (stagingParsed === false) {
          window.SUPABASE_SYNC_ENABLED = false;
          return;
        }
      }
      window.SUPABASE_SYNC_ENABLED = true;
      return;
    }

    if (params.has(QUERY_KEY)) {
      var raw = params.get(QUERY_KEY);
      var normalized = String(raw || "").trim().toLowerCase();
      if (normalized === "reset" || normalized === "clear") {
        window.localStorage.removeItem(STORAGE_KEY);
      } else {
        var parsed = parseBool(raw);
        if (parsed !== null) {
          window.localStorage.setItem(STORAGE_KEY, parsed ? "true" : "false");
        }
      }
    }

    var stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "true") {
      window.SUPABASE_SYNC_ENABLED = true;
    } else if (stored === "false") {
      window.SUPABASE_SYNC_ENABLED = false;
    }
  } catch (e) {
    // Ignore query/localStorage parsing failures and keep default flag.
  }
})();
