#!/usr/bin/env node
// Tidy a CSV file: trim cells, drop empty rows, write the result next to it.
const fs = require("node:fs");
const path = require("node:path");
const { parseCsv, toCsv } = require("./lib/csv");

const [input, ...rest] = process.argv.slice(2);
if (!input) {
  console.error("Usage: node src/tidy.js <file.csv> [--out <folder>]");
  process.exit(1);
}
const outFlag = rest.indexOf("--out");
const outDir = outFlag >= 0 ? rest[outFlag + 1] : "tidy-output";

const rows = parseCsv(fs.readFileSync(input, "utf8"))
  .map((row) => row.map((cell) => cell.trim()))
  .filter((row) => row.some((cell) => cell !== ""));
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, path.basename(input)), toCsv(rows));
console.log(`Wrote ${rows.length} rows`);
