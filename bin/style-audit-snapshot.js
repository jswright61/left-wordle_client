#!/usr/bin/env node
"use strict";

// Captures getComputedStyle() for every element on the given pages, keyed
// by DOM position. Meant to be run once against the page's current state
// ("before" a CSS refactor) and once after, then compared with
// bin/style-audit-diff.js -- so "did this change anything visually" is an
// exact, reviewable list instead of eyeballing screenshots.
//
// Assumes the refactor doesn't touch body markup (only <head> stylesheet
// references) -- if it does, element counts will differ and position-based
// matching breaks down; the diff script calls that out explicitly rather
// than silently comparing the wrong elements to each other.

const { chromium } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

// Deliberately broad rather than guessing which properties matter --
// covers every property declared anywhere across the pages this tool has
// been used on so far (typography, color, box model, layout).
const PROPERTIES = [
  "display", "position", "boxSizing", "cursor", "verticalAlign", "whiteSpace",
  "color", "backgroundColor",
  "fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight",
  "letterSpacing", "textAlign", "textTransform", "textDecorationLine",
  "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
  "borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor",
  "borderTopStyle", "borderRightStyle", "borderBottomStyle", "borderLeftStyle",
  "borderTopLeftRadius", "borderTopRightRadius",
  "borderBottomLeftRadius", "borderBottomRightRadius",
  "marginTop", "marginRight", "marginBottom", "marginLeft",
  "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "width", "maxWidth", "minWidth", "height",
  "gap", "flexDirection", "alignItems", "justifyContent", "flexWrap",
  "outlineStyle", "transitionProperty", "transitionDuration",
  "accentColor"
];

async function snapshotPage(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(url, { waitUntil: "networkidle" });
  const result = await page.evaluate((props) => {
    return Array.from(document.body.querySelectorAll("*")).map((el) => {
      const cs = getComputedStyle(el);
      const styles = {};
      for (const p of props) styles[p] = cs[p];
      return {
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        className: typeof el.className === "string" ? el.className : null,
        styles,
      };
    });
  }, PROPERTIES);
  await page.close();
  return result;
}

async function main() {
  const [, , outPath, ...pages] = process.argv;
  if (!outPath || pages.length === 0) {
    console.error("Usage: bin/style-audit-snapshot.js <out.json> <page1> [page2 ...]");
    console.error("  (page args are paths relative to http://localhost:3000/)");
    process.exit(1);
  }

  const browser = await chromium.launch();
  const snapshot = {};
  try {
    for (const p of pages) {
      const url = `http://localhost:3000/${p}`;
      console.error(`→ Snapshotting ${p}...`);
      snapshot[p] = await snapshotPage(browser, url);
    }
  } finally {
    await browser.close();
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2));
  console.error(`✓ Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
