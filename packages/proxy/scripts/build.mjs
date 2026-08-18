/**
 * Proxy 打包：
 * 1. Node 运行时（dist/runtime/node.js）：Docker / 本地 node 部署
 *
 * Cloudflare 生产为单 Worker 二合一：Proxy 逻辑（`@cloud-api/proxy`）作为库被
 * Admin Worker 直接复用（见 packages/admin/lib/proxy-app.ts），不再单独打包/部署
 * 独立 Proxy Worker，因此不再产出 dist/worker.js。
 *
 * 打包时把 `@cloud-api/*` workspace 源码打进 bundle，
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

// ── Node 运行时 ─────────────────────────────────────────────────────
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
