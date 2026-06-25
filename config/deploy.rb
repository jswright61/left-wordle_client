# frozen_string_literal: true

lock "~> 3.19"

set :application, "left_wordle"
set :repo_url, "deploy@paula-poundstone:/home/deploy/git/left_wordle_client.git"

set :keep_releases, 5

set :app_version, -> {
  tag = `git describe --tags --exact-match 2>/dev/null`.strip
  raise "Current commit has no exact version tag — tag before deploying" if tag.empty?
  tag
}

set :release_timestamp, -> { Time.now.utc.strftime("%Y-%m-%d_%H.%M.%S__#{fetch(:app_version)}") }
