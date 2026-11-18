# frozen_string_literal: true

lock "~> 3.19"

# Deploys follow server_setup's per-app conventions (its add_app.rb --www): each stage
# has its own OS account, left_wordle_<stage>, shared with the api. The api deploys to
# the account's home; this client deploys beside it into ~/www, from its own bare repo at
# ~/git/left_wordle_www.git. Stage files set :app_user; everything else here derives
# from it.
set :application, "left_wordle"
set :server_host, "ellen-degeneres"

set :deploy_to, -> { "/home/#{fetch(:app_user)}/www" }
set :repo_url, -> { "#{fetch(:app_user)}@#{fetch(:server_host)}:/home/#{fetch(:app_user)}/git/left_wordle_www.git" }

set :keep_releases, 5
set :passkey_auth_enabled, false
