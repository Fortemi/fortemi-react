const decoder = new TextDecoder()

export function parseJsonlBytes<T>(data: Uint8Array | undefined): T[] {
  if (!data || data.byteLength === 0) return []
  return decoder.decode(data).split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line) as T)
}

export function parseJsonArrayBytes<T>(data: Uint8Array | undefined): T[] {
  if (!data || data.byteLength === 0) return []
  return JSON.parse(decoder.decode(data)) as T[]
}
