# frozen_string_literal: true

namespace :deploy do
  task :write_robots_txt do
    allow_search_indexing = fetch(:allow_search_indexing, false)

    content =
      if allow_search_indexing
        local_root = File.expand_path("../../..", File.dirname(__FILE__))
        File.read(File.join(local_root, "robots.txt"))
      else
        <<~TXT
          User-agent: *
          Disallow: /
        TXT
      end

    on roles(:app) do
      upload! StringIO.new(content), release_path.join("robots.txt")
    end
  end
end

after "git:create_release", "deploy:write_robots_txt"
