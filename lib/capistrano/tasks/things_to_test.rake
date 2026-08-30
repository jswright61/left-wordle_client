# frozen_string_literal: true

# things-to-test.html (plus its stylesheet and tasks fragment) is tracked
# in the repo on every branch so it can be edited without special branch
# discipline, but it should never actually be reachable in production.
# Remove these files from the release when :things_to_test_enabled isn't
# set (see config/deploy/staging.rb), so a guessed or bookmarked URL 404s
# for real instead of merely being unlinked.
namespace :deploy do
  task :remove_things_to_test do
    next if fetch(:things_to_test_enabled, false)

    on roles(:app) do
      execute :rm, "-f",
        release_path.join("things-to-test.html"),
        release_path.join("src", "things-to-test.css"),
        release_path.join("things-to-test-tasks.html")
    end
  end
end

after "git:create_release", "deploy:remove_things_to_test"
