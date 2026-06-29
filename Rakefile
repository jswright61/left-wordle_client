# frozen_string_literal: true

desc "Write app_version.js from the latest git version tag.\n" \
     "Pass a version to skip the git lookup: rake app_version[vX.Y.Z]"
task :app_version, [:version] do |_t, args|
  version = args[:version]

  unless version
    version = `git tag --list 'v*' --sort=-version:refname 2>/dev/null`
      .lines
      .map(&:strip)
      .find { |t| t.match?(/\Av\d+\.\d+\.\d+\z/) }
    abort "No version tag found. Create one with: git tag -a vX.Y.Z -m 'Release X.Y.Z'" unless version
  end

  abort "Invalid version '#{version}' — expected format: vX.Y.Z" unless version.match?(/\Av\d+\.\d+\.\d+/)

  path = File.join(__dir__, "app_version.js")
  File.write(path, "// generated; do not edit\nwindow.APP_VERSION = #{version.inspect};\n")
  puts "Wrote APP_VERSION = #{version.inspect}"
end
