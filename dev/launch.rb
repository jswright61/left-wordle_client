#!/usr/bin/env ruby
# frozen_string_literal: true

require "optparse"

# Bare-bones launcher for the API (rackup) and Caddy together, so the client
# is reachable at https://left-wordle.test -- see
# api/config/caddy/dev/Caddyfile. Normally invoked via dev/launch.sh, which
# just forwards ARGV here (or to your own devbin/launch.rb, if you have one --
# devbin/ is gitignored, for personal customization of this).

CLIENT_DIR = File.expand_path("..", __dir__)
API_DIR = File.expand_path("../api", CLIENT_DIR)

options = {port: 9292}
parser = OptionParser.new do |opts|
  opts.banner = "Usage: dev/launch.sh [--port PORT]"
  opts.on("-p", "--port PORT", Integer, "Port for the API (rackup); Caddy proxies /api/* to it. Default: 9292") do |port|
    options[:port] = port
  end
  opts.on("-h", "--help", "Show this help") do
    puts opts
    exit
  end
end
parser.parse!(ARGV)

port = options[:port]

def command_exists?(name)
  system("command -v #{name} > /dev/null 2>&1")
end

unless command_exists?("caddy")
  warn "caddy is not installed (needed to serve https://left-wordle.test over TLS)."
  warn "Install it, e.g.: brew install caddy"
  exit 1
end

def hosts_entry_present?(host)
  File.readlines("/etc/hosts").any? do |line|
    line.split("#").first.to_s.split.include?(host)
  end
rescue Errno::ENOENT, Errno::EACCES
  true # can't verify -- don't block startup on it
end

unless hosts_entry_present?("left-wordle.test")
  warn "left-wordle.test is not in /etc/hosts."
  warn 'Add it: echo "127.0.0.1 left-wordle.test" | sudo tee -a /etc/hosts'
  exit 1
end

def listeners_on(port)
  `lsof -nP -iTCP:#{port} -sTCP:LISTEN 2>/dev/null`
    .lines
    .drop(1)
    .map { |line| line.split(/\s+/) }
    .map { |cols| {pid: cols[1], command: cols[0], user: cols[2]} }
    .uniq { |listener| listener[:pid] }
end

listeners = listeners_on(port)
unless listeners.empty?
  warn "Port #{port} is already in use:"
  listeners.each { |l| warn "  PID #{l[:pid]}  #{l[:command]}  (#{l[:user]})" }
  warn "Run on a different port instead: dev/launch.sh --port <PORT>"
  exit 1
end

# pid => label, for both the cleanup trap and the "who died" message below.
names = {}

at_exit do
  names.each_key do |pid|
    Process.kill("TERM", pid)
  rescue Errno::ESRCH
    nil
  end
end

trap("INT") { exit }
trap("TERM") { exit }

# rv (https://github.com/spinel-coop/rv and similar) doesn't hook the shell
# to auto-select a project's pinned Ruby the way rbenv/asdf/chruby do -- it
# only takes effect via an explicit `rv run`. Prefixing with it when present
# and otherwise trusting whatever's already active covers both cases.
rv_prefix = command_exists?("rv") ? ["rv", "run"] : []

Dir.chdir(API_DIR) do
  names[Process.spawn(*rv_prefix, "bundle", "exec", "rackup", "-p", port.to_s)] = "rackup"

  # Needs sudo to bind :443 and (on first run) to trust Caddy's local CA.
  # -E carries LEFT_WORDLE_API_PORT through sudo so the Caddyfile's
  # reverse_proxy target (see config/caddy/dev/Caddyfile) matches rackup's
  # actual port when it isn't the default.
  names[Process.spawn(
    {"LEFT_WORDLE_API_PORT" => port.to_s},
    "sudo", "-E", "caddy", "run", "--config", "config/caddy/dev/Caddyfile"
  )] = "caddy"
end

# Whichever of the two exits first (crash, port conflict inside rackup,
# sudo/caddy failing to bind, etc.) takes the other down with it via the
# at_exit trap above -- neither is meant to run without the other.
exited_pid, status = Process.wait2
name = names.delete(exited_pid)
detail = status.exited? ? "exit status #{status.exitstatus}" : "signal #{status.termsig}"
warn "#{name} exited (#{detail}) -- stopping the other process."
exit(status.success? ? 0 : 1)
