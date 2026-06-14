/* global URL, console */

import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const distDir = fileURLToPath(new URL('../dist/assets/', import.meta.url))
const distRoot = fileURLToPath(new URL('../dist/', import.meta.url))

async function collectFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...await collectFiles(fullPath))
    } else if (/\.(js|css)$/.test(entry.name)) {
      files.push(fullPath)
    }
  }
  return files
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`
}

const files = await collectFiles(distDir)
const rows = []
for (const file of files) {
  const metadata = await stat(file)
  const gzipSize = gzipSync(readFileSync(file)).byteLength
  rows.push({
    file: path.relative(distRoot, file),
    size: metadata.size,
    gzipSize,
  })
}

rows.sort((a, b) => b.size - a.size || a.file.localeCompare(b.file))

console.log('Bundle size report')
console.log('file,size,gzip')
for (const row of rows) {
  console.log(`${row.file},${formatBytes(row.size)},${formatBytes(row.gzipSize)}`)
}
