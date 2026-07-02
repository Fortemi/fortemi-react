// Copy each workspace package README into ../docs/content/packages/<pkg>.md so the
// docbase publishes per-package documentation with the package README as the
// single source of truth. Run before `pagenary build:tenants`.
//
// docs/content/packages/ is gitignored — these pages are generated at build time.
import { mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const outDir = resolve(repoRoot, 'docs', 'content', 'packages');
mkdirSync(outDir, { recursive: true });

const packages = ['core', 'graph', 'react'];
let copied = 0;
for (const pkg of packages) {
  const src = resolve(repoRoot, 'packages', pkg, 'README.md');
  const dst = resolve(outDir, `${pkg}.md`);
  if (existsSync(src)) {
    copyFileSync(src, dst);
    console.log(`  packages/${pkg}/README.md -> docs/content/packages/${pkg}.md`);
    copied++;
  } else {
    console.warn(`  (skip) no README at packages/${pkg}/README.md`);
  }
}
console.log(`prebuild-packages: ${copied}/${packages.length} package pages generated`);
