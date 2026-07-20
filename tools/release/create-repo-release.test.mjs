#!/usr/bin/env node

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createChecksumManifest } from './checksum-manifest.mjs';

test('creates a sha256sum-compatible manifest in asset order', () => {
  const manifest = createChecksumManifest([
    { name: 'fortemi-core-1.2.3.tgz', bytes: Buffer.from('core') },
    { name: 'fortemi-graph-1.2.3.tgz', bytes: Buffer.from('graph') },
    { name: 'fortemi-react-1.2.3.tgz', bytes: Buffer.from('react') },
  ]);

  assert.equal(
    manifest,
    '0d45f5fd462b8c70bffb10021ac1bcff3f58f29b1faf7568595095427d42812c  fortemi-core-1.2.3.tgz\n' +
      'eef93e1d14482804277fca0172464032d1a4fdbcc338524059fa1e861454ad4d  fortemi-graph-1.2.3.tgz\n' +
      '275976081ce1abf67779eb3c388b5e14531082e52137502e264776e1a6a11595  fortemi-react-1.2.3.tgz\n',
  );
});
