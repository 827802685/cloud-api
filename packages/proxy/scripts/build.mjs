/**
 * Proxy 双目标打包：
 * 1. Node 运行时（dist/runtime/node.js）：Docker / 本地 node 部署
 * 2. Cloudflare Workers（dist/worker.js）：Connect to Git / wrangler deploy
 *
 * 两种目标都把 `@cloud-api/*` workspace 源码打进 bundle，
 * 其余裸导入（hono、postgres、drizzle-orm…）保持 external。
 */
import * as esbuild from 'esbuild';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(__dirname, '..');

/** 裸导入中仅 `@cloud-api/*` 走默认解析（打进 bundle）；其余 external。 */
const bundleWorkspacePackages = {
	name: 'bundle-workspace-packages',
	setup(build) {
		build.onResolve({ filter: /^[^./]/ }, (args) => {
			if (args.path.startsWith('@cloud-api/')) {
				return undefined;
			}
			return { path: args.path, external: true };
		});
	},
};

// ── 目标 1：Node 运行时 ─────────────────────────────────────────────
const nodeOutfile = join(pkgRoot, 'dist/runtime/node.js');

await esbuild.build({
	entryPoints: [join(pkgRoot, 'src/runtime/node.ts')],
	bundle: true,
	platform: 'node',
	format: 'esm',
	outfile: nodeOutfile,
	logLevel: 'warning',
	plugins: [bundleWorkspacePackages],
});

verifyNoWorkspaceExternals(nodeOutfile);
console.log('[proxy/build] OK: node bundle →', nodeOutfile);

// ─ 目标 2：Cloudflare Workers（Connect to Git / wrangler deploy）────
const cfOutfile = join(pkgRoot, 'dist/worker.js');

await esbuild.build({
	entryPoints: [join(pkgRoot, 'src/index.ts')],
	bundle: true,
	platform: 'neutral',
	format: 'esm',
	outfile: cfOutfile,
	logLevel: 'warning',
	plugins: [bundleWorkspacePackages],
});

verifyNoWorkspaceExternals(cfOutfile);
console.log('[proxy/build] OK: cf bundle   →', cfOutfile);

/** 产物不得再含 `@cloud-api/*` 外部说明符。 */
function verifyNoWorkspaceExternals(outfile) {
	const source = readFileSync(outfile, 'utf8');
	const re = /(?:from\s+|import\s*\(\s*)["'](@cloud-api\/[^"']+)["']/g;
	const found = new Set();
	for (const m of source.matchAll(re)) {
		found.add(m[1]);
	}
	if (found.size > 0) {
		console.error('[proxy/build] bundle still references @cloud-api/* as external:');
		for (const id of [...found].sort()) {
			console.error(`  ${id}`);
		}
		process.exit(1);
	}
}
