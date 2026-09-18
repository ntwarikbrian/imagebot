import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "src");
const DIST = path.join(ROOT, "dist");

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dest);
    else if (entry.isFile()) fs.copyFileSync(src, dest);
  }
}

function build() {
  fs.rmSync(DIST, { recursive: true, force: true });
  copyDir(SRC, DIST);
  fs.copyFileSync(path.join(ROOT, "README.md"), path.join(DIST, "README.md"));
  console.log(`Built ${DIST}`);
}

const watch = process.argv.includes("watch");
build();
if (watch) {
  let timer;
  fs.watch(SRC, { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(build, 150);
  });
  console.log(`Watching ${SRC} for changes…`);
}