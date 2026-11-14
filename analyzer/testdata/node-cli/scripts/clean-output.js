#!/usr/bin/env node
// Delete the tidy-output folder.
const fs = require("node:fs");
fs.rmSync("tidy-output", { recursive: true, force: true });
console.log("Removed tidy-output");
