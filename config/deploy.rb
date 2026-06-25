# frozen_string_literal: true

lock "~> 3.19"

set :application, "left_wordle"
set :repo_url, "deploy@paula-poundstone:/home/deploy/git/left_wordle_client.git"

set :keep_releases, 5
