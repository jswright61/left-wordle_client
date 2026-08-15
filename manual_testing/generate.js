#!/usr/bin/env node
// Regenerates the scene_*.json fixtures in manual_testing/ from the
// relative-offset templates in manual_testing/templates/.
//
// The scenarios (see README.md) are written in terms of "today" and
// "N days ago" -- but puzzle_num is a fixed function of calendar date
// (see PUZZLE_EPOCH in api/lib/left_wordle/game.rb), so a fixture with
// dates/puzzle_nums baked in only lines up with the app's real "today" on
// the one date it was generated for. The templates store each history
// entry's offset from "today" as `daysAgo` instead of a literal date, so
// this script can re-anchor them to whatever day you're actually testing
// on.
//
// Usage:
//   node manual_testing/generate.js                  # anchor = real today
//   node manual_testing/generate.js --today=2026-09-01
const fs = require("fs");
const path = require("path");

const PUZZLE_EPOCH = Date.UTC(2021, 5, 19); // 2021-06-19, matches api/lib/left_wordle/game.rb
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const COMPLETED_AT_UTC_HOUR = 19; // matches the fixed hour baked into the original fixtures

const TEMPLATES_DIR = path.join(__dirname, "templates");
const OUT_DIR = __dirname;

function parseTodayArg() {
  const arg = process.argv.find((a) => a.startsWith("--today="));
  if (!arg) return new Date();
  const [y, m, d] = arg.slice("--today=".length).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function dateNDaysBefore(anchorUtcMs, daysAgo) {
  return new Date(anchorUtcMs - daysAgo * MS_PER_DAY);
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function puzzleNumFor(date) {
  return Math.round((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - PUZZLE_EPOCH) / MS_PER_DAY);
}

function completedAtFor(date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), COMPLETED_AT_UTC_HOUR);
}

function resolveHistory(history, anchorUtcMs) {
  const resolved = {};
  for (const entry of Object.values(history)) {
    const { daysAgo, ...rest } = entry;
    const date = dateNDaysBefore(anchorUtcMs, daysAgo);
    const puzzleNum = puzzleNumFor(date);
    const timestamp = completedAtFor(date);
    resolved[String(puzzleNum)] = {
      puzzle_num: puzzleNum,
      date: isoDate(date),
      ...rest,
      completed_at: timestamp,
      updated_at: timestamp,
    };
  }
  return resolved;
}

const LEGACY_DAYS_AGO_FIELDS = {
  currentStreakEndDaysAgo: "current_streak_end_date",
  recordedOnDaysAgo: "recorded_on",
  cutoffDaysAgo: "cutoff_date",
};

function resolveLegacyStats(legacyStats, anchorUtcMs) {
  const resolved = { ...legacyStats };
  for (const [daysAgoField, dateField] of Object.entries(LEGACY_DAYS_AGO_FIELDS)) {
    if (daysAgoField in resolved) {
      resolved[dateField] = isoDate(dateNDaysBefore(anchorUtcMs, resolved[daysAgoField]));
      delete resolved[daysAgoField];
    }
  }
  return resolved;
}

function generate(templatePath, anchorUtcMs) {
  const template = JSON.parse(fs.readFileSync(templatePath, "utf8"));
  const output = { ...template };
  if (output.history) output.history = resolveHistory(output.history, anchorUtcMs);
  if (output.legacy_stats) output.legacy_stats = resolveLegacyStats(output.legacy_stats, anchorUtcMs);
  return output;
}

function main() {
  const anchor = parseTodayArg();
  const anchorUtcMs = Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate());
  console.log(`Generating manual_testing fixtures for "today" = ${isoDate(anchor)}`);

  const templateFiles = fs.readdirSync(TEMPLATES_DIR).filter((f) => f.endsWith(".template.json"));
  for (const templateFile of templateFiles) {
    const output = generate(path.join(TEMPLATES_DIR, templateFile), anchorUtcMs);
    const outFile = templateFile.replace(".template.json", ".json");
    fs.writeFileSync(path.join(OUT_DIR, outFile), JSON.stringify(output, null, 2) + "\n");
    console.log(`  wrote ${outFile}`);
  }
}

main();
