import { createHash } from 'node:crypto';

export function createChecksumManifest(assets) {
  return assets
    .map(({ name, bytes }) => `${createHash('sha256').update(bytes).digest('hex')}  ${name}`)
    .join('\n') + '\n';
}
