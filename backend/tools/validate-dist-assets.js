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
  // Resolve backend root via this script location (robust to npm --prefix / different cwd).
  const backendRoot = path.resolve(__dirname, '..');
  const srcRoot = path.resolve(backendRoot, 'src', 'lib', 'flowEngine', 'builtInFlows');
  const distRoot = path.resolve(backendRoot, 'dist', 'lib', 'flowEngine', 'builtInFlows');

  if (!fs.existsSync(srcRoot)) {
    console.error(`[validate:dist-assets] Missing source directory: ${srcRoot}`);
    process.exit(1);
  }
  if (!fs.existsSync(distRoot)) {
    console.error(`[validate:dist-assets] Missing dist directory: ${distRoot}`);
    console.error('[validate:dist-assets] This usually means JSON assets were not copied during build.');
    process.exit(1);
  }

  const allSrcAbs = [];
  walkFiles(srcRoot, allSrcAbs);

  const srcJsonAbs = allSrcAbs.filter((p) => p.toLowerCase().endsWith('.json'));
  if (srcJsonAbs.length === 0) {
    console.error(`[validate:dist-assets] No JSON files found under: ${srcRoot}`);
    process.exit(1);
  }

  const missing = [];
  for (const abs of srcJsonAbs) {
    const rel = path.relative(srcRoot, abs);
    const expected = path.resolve(distRoot, rel);
    if (!fs.existsSync(expected)) missing.push(rel);
  }

  if (missing.length > 0) {
    console.error(`[validate:dist-assets] Missing ${missing.length} builtInFlows JSON asset(s) in dist:`);
    for (const rel of missing) console.error(`- ${path.posix.join('dist/lib/flowEngine/builtInFlows', rel.split(path.sep).join('/'))}`);
    console.error('');
    console.error('[validate:dist-assets] Failing build to prevent broken production images.');
    process.exit(1);
  }

  console.log(`[validate:dist-assets] OK: ${srcJsonAbs.length} JSON asset(s) present in dist.`);
}

main();

