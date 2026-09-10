import { Buffer as BrowserBuffer } from 'buffer/index.js'

// wkx uses a module-local Buffer in browser bundles, without changing globals.
export const Buffer = typeof globalThis.Buffer === 'undefined' ? BrowserBuffer : globalThis.Buffer
