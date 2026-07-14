# frozen_string_literal: true

set :branch, "staging"
set :deploy_to, "/home/deploy/staging.left-wordle.com"
set :caddy_host, "https://staging.left-wordle.com"
set :api_base_url, "https://staging.left-wordle.com"
set :allow_search_indexing, false

server "paula-poundstone",
  user: "deploy",
  roles: %w[web app],
  ssh_options: {forward_agent: true}
