import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const projectRoot = resolve(import.meta.dir, '..');
const distRoot = resolve(projectRoot, 'dist');

await rm(distRoot, { recursive: true, force: true });

const result = await Bun.build({
	entrypoints: [resolve(projectRoot, 'index.html')],
	outdir: distRoot,
	target: 'browser',
	minify: true,
	sourcemap: 'external',
});

if (!result.success) throw new AggregateError(result.logs, 'Browser bundle failed');

console.log(`Built ${result.outputs.length} files in dist/`);
