# frozen_string_literal: true

set :branch, "main"
set :app_user, "left_wordle_production"
set :caddy_host, "https://left-wordle.com"
set :api_base_url, "https://left-wordle.com"
set :allow_search_indexing, true
set :passkey_auth_enabled, true

server fetch(:server_host),
  user: fetch(:app_user),
  roles: %w[web app],
  ssh_options: {forward_agent: true}
