#!/usr/bin/env node
/**
 * Walks `backend/models/ch*\/` and runs gltfpack on each `.glb`:
 *   - `-cc`: high-ratio Meshopt vertex/index compression (requires MeshoptDecoder on loader)
 *   - `-tc`: convert textures to KTX2 with BasisU supercompression (requires KTX2Loader)
 *   - `-tq 8`: texture quality (1-10; 8 is the sweet spot for TV viewing distance)
 *   - `-kn -ke`: preserve named nodes (so the bone-name regex still resolves) and extras
 *   - `-mm`: merge duplicate mesh instances
 *
 * Originals are moved to `backend/models/_originals/<charDir>/<file>` (kept around in case
 * we need to re-bake with different settings); the optimized output replaces the original
 * filename so no frontend code changes.
 *
 * Idempotent: skips files whose `_originals` copy already exists (i.e. already optimized).
 * Pass `--force` to re-process from the archived originals.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { spawnSync, execSync } = require('child_process');

const MODELS_DIR = path.resolve(__dirname, '..', 'models');
const ORIGINALS_DIR = path.join(MODELS_DIR, '_originals');
const BIN_DIR = path.join(__dirname, 'bin');
const GLTFPACK_BIN = path.join(BIN_DIR, process.platform === 'win32' ? 'gltfpack.exe' : 'gltfpack');
const FORCE = process.argv.includes('--force');

// `-cc` enables Meshopt high-ratio compression (requires MeshoptDecoder on the loader).
// `-tc -tq 8` enables KTX2/BasisU texture compression at quality 8 (requires KTX2Loader).
// `-kn -ke` preserves named nodes + extras so our bone-name regex still resolves.
// (We intentionally drop `-mm`: gltfpack warns it's incompatible with `-kn` and we need names.)
const GLTFPACK_FLAGS = ['-cc', '-tc', '-tq', '8', '-kn', '-ke'];

// ---------------------------------------------------------------------------
// gltfpack binary bootstrap
// ---------------------------------------------------------------------------
//
// The npm `gltfpack` package omits BasisU on Node — required for KTX2 textures.
// We download the platform-native binary from the official release on first run
// and cache it under `scripts/bin/`. The binary is gitignored.

const RELEASE_TAG = 'v1.1';
const RELEASE_ASSETS = {
  'darwin-arm64': 'gltfpack-macos.zip',
  'darwin-x64': 'gltfpack-macos-intel.zip',
  'linux-x64': 'gltfpack-ubuntu.zip',
  'win32-x64': 'gltfpack-windows.zip'
};

function platformKey() {
  return `${process.platform}-${process.arch}`;
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const get = (u) =>
      https
        .get(u, (res) => {
          if (res.statusCode === 301 || res.statusCode === 302) {
            res.resume();
            return get(res.headers.location);
          }
          if (res.statusCode !== 200) {
            return reject(new Error(`download ${u} failed: HTTP ${res.statusCode}`));
          }
          res.pipe(file);
          file.on('finish', () => file.close(() => resolve()));
        })
        .on('error', reject);
    get(url);
  });
}

async function ensureGltfpack() {
  if (fs.existsSync(GLTFPACK_BIN)) return GLTFPACK_BIN;

  const key = platformKey();
  const asset = RELEASE_ASSETS[key];
  if (!asset) {
    throw new Error(
      `no prebuilt gltfpack for ${key}. Download manually from ` +
      `https://github.com/zeux/meshoptimizer/releases and place at ${GLTFPACK_BIN}.`
    );
  }

  fs.mkdirSync(BIN_DIR, { recursive: true });
  const url = `https://github.com/zeux/meshoptimizer/releases/download/${RELEASE_TAG}/${asset}`;
  const zip = path.join(os.tmpdir(), asset);
  console.log(`fetching gltfpack ${RELEASE_TAG} for ${key}...`);
  await downloadFile(url, zip);
  execSync(`unzip -o ${JSON.stringify(zip)} -d ${JSON.stringify(BIN_DIR)}`, { stdio: 'ignore' });
  fs.unlinkSync(zip);
  if (!fs.existsSync(GLTFPACK_BIN)) {
    throw new Error(`unzip succeeded but ${GLTFPACK_BIN} not found`);
  }
  fs.chmodSync(GLTFPACK_BIN, 0o755);
  console.log(`installed: ${GLTFPACK_BIN}`);
  return GLTFPACK_BIN;
}

function listCharacterDirs() {
  return fs
    .readdirSync(MODELS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^ch\d+$/i.test(d.name))
    .map((d) => path.join(MODELS_DIR, d.name));
}

function listGlbsRecursive(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listGlbsRecursive(full));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.glb')) out.push(full);
  }
  return out;
}

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function archivePath(glb) {
  const rel = path.relative(MODELS_DIR, glb);
  return path.join(ORIGINALS_DIR, rel);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function processFile(glb) {
  const archived = archivePath(glb);
  const alreadyArchived = fs.existsSync(archived);

  // Source for optimization: archived original if present, else the live file.
  let source = glb;
  if (alreadyArchived) {
    if (!FORCE) {
      console.log(`  skip (already optimized): ${path.relative(MODELS_DIR, glb)}`);
      return { skipped: true };
    }
    source = archived;
  }

  const tmpOut = glb + '.opt.tmp.glb';
  const beforeSize = fs.statSync(source).size;

  console.log(`  optimizing: ${path.relative(MODELS_DIR, glb)} (${fmtBytes(beforeSize)})`);

  const result = spawnSync(
    GLTFPACK_BIN,
    ['-i', source, '-o', tmpOut, ...GLTFPACK_FLAGS],
    { stdio: ['ignore', 'inherit', 'inherit'] }
  );

  if (result.status !== 0) {
    if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut);
    throw new Error(`gltfpack failed for ${glb} (exit ${result.status})`);
  }

  const afterSize = fs.statSync(tmpOut).size;

  if (!alreadyArchived) {
    ensureDir(path.dirname(archived));
    fs.renameSync(glb, archived);
  }
  fs.renameSync(tmpOut, glb);

  const ratio = ((1 - afterSize / beforeSize) * 100).toFixed(1);
  console.log(`     -> ${fmtBytes(afterSize)} (${ratio}% smaller)`);

  return { beforeSize, afterSize };
}

async function main() {
  if (!fs.existsSync(MODELS_DIR)) {
    console.error(`models dir not found: ${MODELS_DIR}`);
    process.exit(1);
  }

  await ensureGltfpack();

  const charDirs = listCharacterDirs();
  if (charDirs.length === 0) {
    console.log('no character directories found (expected ch01, ch02, ...)');
    return;
  }

  let totalBefore = 0;
  let totalAfter = 0;
  let processed = 0;

  for (const charDir of charDirs) {
    console.log(`character: ${path.basename(charDir)}`);
    const glbs = listGlbsRecursive(charDir);
    if (glbs.length === 0) {
      console.log('  (no .glb files)');
      continue;
    }
    for (const glb of glbs) {
      const r = processFile(glb);
      if (r.skipped) continue;
      totalBefore += r.beforeSize;
      totalAfter += r.afterSize;
      processed += 1;
    }
  }

  if (processed === 0) {
    console.log('\nnothing processed. Pass --force to re-optimize from _originals/.');
    return;
  }

  const ratio = ((1 - totalAfter / totalBefore) * 100).toFixed(1);
  console.log(`\ntotal: ${fmtBytes(totalBefore)} -> ${fmtBytes(totalAfter)} (${ratio}% smaller, ${processed} file${processed === 1 ? '' : 's'})`);
}

main().catch((e) => {
  console.error('\nERROR:', e.message);
  process.exit(1);
});
