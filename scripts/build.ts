#!/usr/bin/env bun
/**
 * Build script: compiles src/ into a publishable `dist/` folder.
 *
 *  - `bun build` produces ESM JS with .ts extensions rewritten to .js.
 *  - `tsc --emitDeclarationOnly` produces matching .d.ts files.
 *  - The two outputs are interleaved so each `.js` has a sibling `.d.ts`.
 */

import { rmSync, existsSync, readdirSync, statSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

const ROOT = new URL("..", import.meta.url).pathname
const DIST = join(ROOT, "dist")
const SRC  = join(ROOT, "src")

if (existsSync(DIST)) rmSync(DIST, { recursive: true })

console.log("→ collecting source files (for type emission)")
const ALL_TS: string[] = []
function walk(dir: string) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const s = statSync(p)
    if (s.isDirectory()) walk(p)
    else if (s.isFile() && p.endsWith(".ts") && !p.endsWith(".d.ts")) ALL_TS.push(p)
  }
}
walk(SRC)
console.log(`  ${ALL_TS.length} files`)

// Public entry points. Anything imported from these is bundled; subpath
// exports must be listed here for tree-shake-friendly distribution.
const ENTRIES = [
  join(SRC, "index.ts"),
  join(SRC, "charsets/index.ts"),
]

console.log("→ bun build (JS, ESM, target=node, splitting=true)")
const r1 = await Bun.build({
  entrypoints: ENTRIES,
  outdir: DIST,
  root: SRC,
  target: "node",
  format: "esm",
  external: ["@opentui/core"],
  splitting: true,
  sourcemap: "linked",
  naming: "[dir]/[name].[ext]",
})
if (!r1.success) {
  for (const log of r1.logs) console.error(log)
  process.exit(1)
}
console.log(`  emitted ${r1.outputs.length} artefacts`)

// Bun emits ".js" but our source uses ".ts" import suffixes. Rewrite them.
console.log("→ rewriting .ts import specifiers in emitted JS")
const rewriteCount = { js: 0, ts: 0 }
function rewriteJs(file: string) {
  if (!file.endsWith(".js")) return
  const src = readFileSync(file, "utf8")
  const out = src.replace(/(from\s+["'][^"']+?)\.ts(["'])/g, "$1.js$2")
  if (out !== src) {
    writeFileSync(file, out)
    rewriteCount.js++
  }
}
function walkDist(dir: string) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const s = statSync(p)
    if (s.isDirectory()) walkDist(p)
    else if (p.endsWith(".js")) rewriteJs(p)
  }
}
walkDist(DIST)
console.log(`  rewrote ${rewriteCount.js} .js files`)

console.log("→ tsc --emitDeclarationOnly")
// Re-enter through the running Bun executable instead of assuming a separate
// `bunx` shim is on PATH. Version managers commonly expose only `bun` to the
// script process, which made an otherwise healthy build fail after JS emit.
const r2 = spawnSync(process.execPath, [
  "x", "tsc", "--emitDeclarationOnly",
  "--declaration",
  "--declarationMap",
  "--outDir", DIST,
  "--rootDir", SRC,
  "--module", "ESNext",
  "--moduleResolution", "bundler",
  "--target", "ESNext",
  "--strict",
  "--noUncheckedIndexedAccess",
  "--exactOptionalPropertyTypes",
  "--skipLibCheck",
  "--allowImportingTsExtensions",
  ...ALL_TS,
], { stdio: "inherit", cwd: ROOT })
if (r2.status !== 0) {
  console.error("✗ tsc failed")
  process.exit(1)
}

// tsc emits .d.ts but with .ts import paths (because allowImportingTsExtensions).
// Rewrite imports inside .d.ts to point at .js so consumers resolve correctly.
console.log("→ rewriting .ts import specifiers in emitted .d.ts")
function rewriteDts(file: string) {
  if (!file.endsWith(".d.ts")) return
  const src = readFileSync(file, "utf8")
  const out = src.replace(/(from\s+["'][^"']+?)\.ts(["'])/g, "$1.js$2")
  if (out !== src) {
    writeFileSync(file, out)
    rewriteCount.ts++
  }
}
function walkDts(dir: string) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const s = statSync(p)
    if (s.isDirectory()) walkDts(p)
    else if (p.endsWith(".d.ts")) rewriteDts(p)
  }
}
walkDts(DIST)
console.log(`  rewrote ${rewriteCount.ts} .d.ts files`)

console.log("✓ build complete")
console.log(`  output: ${DIST}`)
