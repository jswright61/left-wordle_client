# frozen_string_literal: true

set :branch, "main"
set :deploy_to, "/home/deploy/left-wordle.com"
set :caddy_host, "https://left-wordle.com"
set :api_base_url, "https://left-wordle.com"
set :allow_search_indexing, true

server "paula-poundstone",
  user: "deploy",
  roles: %w[web app],
  ssh_options: {forward_agent: true}
