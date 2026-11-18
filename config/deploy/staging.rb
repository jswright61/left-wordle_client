# frozen_string_literal: true

set :branch, "staging"
set :app_user, "left_wordle_staging"
set :caddy_host, "https://staging.left-wordle.com"
set :api_base_url, "https://staging.left-wordle.com"
set :passkey_auth_enabled, true
set :allow_search_indexing, false
set :things_to_test_enabled, true

server fetch(:server_host),
  user: fetch(:app_user),
  roles: %w[web app],
  ssh_options: {forward_agent: true}
