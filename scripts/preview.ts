import { resolve } from 'node:path';

const distRoot = resolve(import.meta.dir, '../dist');
const files = new Map<string, Bun.BunFile>();

// Serve only files found in the build output, never arbitrary request paths.
for await (const path of new Bun.Glob('**/*').scan({ cwd: distRoot, onlyFiles: true })) {
	files.set(`/${path}`, Bun.file(resolve(distRoot, path)));
}

if (!files.has('/index.html')) throw new Error('Run bun run build before previewing.');

const server = Bun.serve({
	port: Number(Bun.env['PORT'] ?? '3000'),
	fetch(request) {
		const pathname = new URL(request.url).pathname;
		const file = files.get(pathname === '/' ? '/index.html' : pathname);
		return file ? new Response(file) : new Response('Not found', { status: 404 });
	},
});

console.log(`Serving dist at ${server.url}`);
