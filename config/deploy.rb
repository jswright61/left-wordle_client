# frozen_string_literal: true

lock "~> 3.19"

set :application, "left_wordle"
set :repo_url, "ssh://git@codeberg.org/jswright61/left_wordle.git"

set :keep_releases, 5
