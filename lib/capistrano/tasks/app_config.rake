# frozen_string_literal: true

namespace :deploy do
  task :write_app_config do
    api_base_url = fetch(:api_base_url)
    version_tag = fetch(:release_version_tag)

    config_js = <<~JS
      (function() {
          "use strict";

          var host = window.location.hostname;
          var isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1";
          var defaults = {
              apiBaseUrl: isLocal ? "http://localhost:9292" : "#{api_base_url}",
              apiCredentials: "omit",
              apiGameplayEnabled: false,
              apiGameplayShadowMode: isLocal,
              apiRequestTimeoutMs: 3000,
              localGameplayFallbackEnabled: true,
              passkeyAuthEnabled: false,
              serverSyncEnabled: false
          };

          window.LEFT_WORDLE_CONFIG = Object.freeze(Object.assign(
              {},
              defaults,
              window.LEFT_WORDLE_CONFIG || {}
          ));
      })();
    JS

    version_js = "// generated; do not edit\nwindow.APP_VERSION = \"#{version_tag}\";\n"

    on roles(:app) do
      upload! StringIO.new(config_js), release_path.join("app_config.js")
      upload! StringIO.new(version_js), release_path.join("app_version.js")
    end
  end
end

after "git:create_release", "deploy:write_app_config"
