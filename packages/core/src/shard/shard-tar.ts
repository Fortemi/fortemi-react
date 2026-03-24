/**
 * Minimal tar + gzip packing/unpacking for shard archives.
 *
 * Uses fflate for gzip compression and implements a lightweight POSIX tar
 * encoder/decoder (512-byte block headers, ustar format).
 */

import { gzipSync, gunzipSync } from 'fflate'

// ── Tar constants ────────────────────────────────────────────────────────

const BLOCK_SIZE = 512
const USTAR_MAGIC = 'ustar\x0000'

// ── Tar encoder ──────────────────────────────────────────────────────────

function writeString(buf: Uint8Array, offset: number, str: string, len: number) {
  for (let i = 0; i < Math.min(str.length, len); i++) {
    buf[offset + i] = str.charCodeAt(i)
  }
}

function writeOctal(buf: Uint8Array, offset: number, value: number, len: number) {
  const str = value.toString(8).padStart(len - 1, '0')
  writeString(buf, offset, str, len - 1)
}

function computeHeaderChecksum(header: Uint8Array): number {
  // For checksum computation, treat the checksum field (offset 148, 8 bytes) as spaces
  let sum = 0
  for (let i = 0; i < BLOCK_SIZE; i++) {
    sum += i >= 148 && i < 156 ? 32 : header[i]
  }
  return sum
}

function createTarHeader(filename: string, size: number): Uint8Array {
  const header = new Uint8Array(BLOCK_SIZE)

  // name (0, 100)
  writeString(header, 0, filename, 100)
  // mode (100, 8) — 0644
  writeOctal(header, 100, 0o644, 8)
  // uid (108, 8)
  writeOctal(header, 108, 0, 8)
  // gid (116, 8)
  writeOctal(header, 116, 0, 8)
  // size (124, 12)
  writeOctal(header, 124, size, 12)
  // mtime (136, 12)
  writeOctal(header, 136, Math.floor(Date.now() / 1000), 12)
  // typeflag (156) — '0' for regular file
  header[156] = 48 // ASCII '0'
  // magic (257, 8) — ustar\000
  writeString(header, 257, USTAR_MAGIC, 8)

  // compute and write checksum (148, 8)
  const checksum = computeHeaderChecksum(header)
  const csStr = checksum.toString(8).padStart(6, '0')
  writeString(header, 148, csStr, 6)
  header[154] = 0 // null terminator
  header[155] = 32 // space

  return header
}

function encodeTar(files: Map<string, Uint8Array>): Uint8Array {
  const blocks: Uint8Array[] = []

  for (const [filename, data] of files) {
    blocks.push(createTarHeader(filename, data.byteLength))
    blocks.push(data)

    // Pad to 512-byte boundary
    const remainder = data.byteLength % BLOCK_SIZE
    if (remainder > 0) {
      blocks.push(new Uint8Array(BLOCK_SIZE - remainder))
    }
  }

  // Two zero blocks mark end of archive
  blocks.push(new Uint8Array(BLOCK_SIZE * 2))

  // Concatenate
  let totalLen = 0
  for (const b of blocks) totalLen += b.byteLength
  const result = new Uint8Array(totalLen)
  let offset = 0
  for (const b of blocks) {
    result.set(b, offset)
    offset += b.byteLength
  }
  return result
}

// ── Tar decoder ──────────────────────────────────────────────────────────

function readString(buf: Uint8Array, offset: number, len: number): string {
  let end = offset
  const limit = offset + len
  while (end < limit && buf[end] !== 0) end++
  return String.fromCharCode(...buf.slice(offset, end))
}

function readOctal(buf: Uint8Array, offset: number, len: number): number {
  const str = readString(buf, offset, len).trim()
  return str.length > 0 ? parseInt(str, 8) : 0
}

function isZeroBlock(buf: Uint8Array, offset: number): boolean {
  for (let i = 0; i < BLOCK_SIZE; i++) {
    if (buf[offset + i] !== 0) return false
  }
  return true
}

function decodeTar(tarData: Uint8Array): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>()
  let offset = 0

  while (offset + BLOCK_SIZE <= tarData.byteLength) {
    // Check for end-of-archive (two zero blocks)
    if (isZeroBlock(tarData, offset)) break

    const name = readString(tarData, offset, 100)
    const size = readOctal(tarData, offset + 124, 12)
    const typeflag = tarData[offset + 156]

    offset += BLOCK_SIZE // skip header

    // Only extract regular files (typeflag '0' or NUL)
    if (typeflag === 48 || typeflag === 0) {
      files.set(name, tarData.slice(offset, offset + size))
    }

    // Advance past data blocks (padded to 512-byte boundary)
    const dataBlocks = Math.ceil(size / BLOCK_SIZE)
    offset += dataBlocks * BLOCK_SIZE
  }

  return files
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Pack files into a gzip-compressed tar archive.
 *
 * @param files Map of filename → file contents
 * @returns Compressed archive bytes (suitable for .shard file)
 */
export function packTarGz(files: Map<string, Uint8Array>): Uint8Array {
  const tarData = encodeTar(files)
  return gzipSync(tarData)
}

/**
 * Unpack a gzip-compressed tar archive.
 *
 * @param data Compressed archive bytes
 * @returns Map of filename → file contents
 */
export function unpackTarGz(data: Uint8Array): Map<string, Uint8Array> {
  const tarData = gunzipSync(data)
  return decodeTar(tarData)
}
