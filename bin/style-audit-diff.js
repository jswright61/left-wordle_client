#!/usr/bin/env node
"use strict";

// Compares two snapshots from bin/style-audit-snapshot.js and prints every
// computed-style difference, element by element, property by property --
// so a CSS refactor gets reviewed against an exact list of what changed
// instead of a visual guess.

const fs = require("fs");

function describe(el) {
  const classPart = el.className
    ? "." + el.className.trim().split(/\s+/).join(".")
    : "";
  const idPart = el.id ? "#" + el.id : "";
  return `<${el.tag}${idPart}${classPart}>`;
}

function main() {
  const [, , beforePath, afterPath] = process.argv;
  if (!beforePath || !afterPath) {
    console.error("Usage: bin/style-audit-diff.js <before.json> <after.json>");
    process.exit(1);
  }

  const before = JSON.parse(fs.readFileSync(beforePath, "utf8"));
  const after = JSON.parse(fs.readFileSync(afterPath, "utf8"));

  let diffCount = 0;
  let pagesWithCountMismatch = 0;

  for (const pageKey of Object.keys(before)) {
    const beforeEls = before[pageKey];
    const afterEls = after[pageKey];

    if (!afterEls) {
      console.log(`\n[${pageKey}] present in "before" but missing from "after" snapshot.`);
      pagesWithCountMismatch++;
      continue;
    }

    if (beforeEls.length !== afterEls.length) {
      console.log(
        `\n[${pageKey}] ELEMENT COUNT CHANGED: ${beforeEls.length} -> ${afterEls.length}. ` +
        `Body markup changed -- positional comparison below is unreliable past the point of divergence.`
      );
      pagesWithCountMismatch++;
    }

    const len = Math.min(beforeEls.length, afterEls.length);
    for (let i = 0; i < len; i++) {
      const b = beforeEls[i];
      const a = afterEls[i];
      const label = `${pageKey} element #${i} ${describe(b)}`;
      for (const prop of Object.keys(b.styles)) {
        if (b.styles[prop] !== a.styles[prop]) {
          diffCount++;
          console.log(`\n${label}\n  ${prop}: ${b.styles[prop]}  ->  ${a.styles[prop]}`);
        }
      }
    }
  }

  for (const pageKey of Object.keys(after)) {
    if (!before[pageKey]) {
      console.log(`\n[${pageKey}] present in "after" but missing from "before" snapshot.`);
      pagesWithCountMismatch++;
    }
  }

  console.log("");
  if (diffCount === 0 && pagesWithCountMismatch === 0) {
    console.log("No computed style differences found.");
    process.exit(0);
  }

  console.log(
    `${diffCount} computed style difference(s) and ${pagesWithCountMismatch} element-count mismatch(es) found (see above).`
  );
  process.exit(1);
}

main();
