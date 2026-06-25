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
              apiRequestTimeoutMs: 3000,
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

namespace :deploy do
  task :write_version_json do
    require "net/http"
    require "uri"
    require "json"

    version_tag = fetch(:release_version_tag)
    api_base_url = fetch(:api_base_url)

    commit = `git rev-parse HEAD 2>/dev/null`.strip
    commit = commit.empty? ? nil : commit[0, 8]

    release = nil
    on roles(:app) do
      if test("[ -f #{revision_log} ]")
        release = capture(:wc, "-l", revision_log).strip.split.first.to_i + 1
      else
        release = 1
      end
    end

    api_version = nil
    begin
      uri = URI.parse("#{api_base_url}/api/v1/version")
      http = Net::HTTP.new(uri.host, uri.port)
      http.use_ssl = uri.scheme == "https"
      http.open_timeout = 5
      http.read_timeout = 5
      response = http.get(uri.request_uri, "Accept" => "application/json")
      api_version = JSON.parse(response.body) if response.is_a?(Net::HTTPSuccess)
    rescue => e
      puts "  Warning: could not fetch API version: #{e.message}"
    end

    version_json = JSON.generate(version: version_tag, commit: commit, release: release, api: api_version) + "\n"

    on roles(:app) do
      upload! StringIO.new(version_json), release_path.join("version.json")
    end
  end
end

after "git:create_release", "deploy:write_version_json"
