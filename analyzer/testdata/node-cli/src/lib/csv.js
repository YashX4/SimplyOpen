// Minimal CSV helpers (no quoted-comma support; enough for simple exports).
function parseCsv(text) {
  return text.split(/\r?\n/).filter((line) => line !== "").map((line) => line.split(","));
}
function toCsv(rows) {
  return rows.map((row) => row.join(",")).join("\n") + "\n";
}
module.exports = { parseCsv, toCsv };
