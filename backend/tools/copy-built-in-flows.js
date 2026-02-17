/* eslint-disable no-console */
const fs = require('node:fs');
const path = require('node:path');

function walkFiles(dirAbs, outFilesAbs) {
  const entries = fs.readdirSync(dirAbs, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dirAbs, e.name);
    if (e.isDirectory()) {
      walkFiles(p, outFilesAbs);
      continue;
    }
    if (e.isFile()) outFilesAbs.push(p);
  }
}

function main() {
  const backendRoot = path.resolve(__dirname, '..');
  const srcRoot = path.resolve(backendRoot, 'src', 'lib', 'flowEngine', 'builtInFlows');
  const distRoot = path.resolve(backendRoot, 'dist', 'lib', 'flowEngine', 'builtInFlows');

  if (!fs.existsSync(srcRoot)) {
    console.error(`[copy-built-in-flows] Missing source directory: ${srcRoot}`);
    process.exit(1);
  }

  const allSrcAbs = [];
  walkFiles(srcRoot, allSrcAbs);
  const srcJsonAbs = allSrcAbs.filter((p) => p.toLowerCase().endsWith('.json'));

  if (srcJsonAbs.length === 0) {
    console.error(`[copy-built-in-flows] No JSON files found under: ${srcRoot}`);
    process.exit(1);
  }

  fs.mkdirSync(distRoot, { recursive: true });

  let copied = 0;
  for (const abs of srcJsonAbs) {
    const rel = path.relative(srcRoot, abs);
    const dst = path.resolve(distRoot, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(abs, dst);
    copied++;
  }

  console.log(`[copy-built-in-flows] Copied ${copied} JSON asset(s) to dist.`);
}

main();

