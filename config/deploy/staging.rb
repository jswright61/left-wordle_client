# frozen_string_literal: true

set :branch, "staging"
set :deploy_to, "/home/deploy/staging.left_wordle.com"
set :caddy_host, "https://staging.left-wordle.com"
set :api_base_url, "https://api-staging.left-wordle.com"

server "paula-poundstone",
  user: "deploy",
  roles: %w[web app],
  ssh_options: {forward_agent: true}
