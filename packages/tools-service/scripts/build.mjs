/**
 * Tools Service 双目标打包：
 * 1. Node 运行时（dist/runtime/node.js）：Docker / 外部服务器部署（推荐）
 * 2. Cloudflare Worker（dist/worker.js）：独立工具 Worker
 **/
import * as esbuild from 'esbuild';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
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
console.log('[tools-service/build] OK: node bundle   →', nodeOutfile);

// ── 目标 2：Cloudflare Worker ───────────────────────────────────────────
const cfOutfile = join(pkgRoot, 'dist/worker.js');
await esbuild.build({
	entryPoints: [join(pkgRoot, 'src/runtime/worker.ts')],
	bundle: true,
	platform: 'neutral',
	format: 'esm',
	outfile: cfOutfile,
	logLevel: 'warning',
	plugins: [bundleWorkspacePackages],
});
verifyNoWorkspaceExternals(cfOutfile);
console.log('[tools-service/build] OK: cf bundle    →', cfOutfile);

// ── 目标 3：Cloudflare Pages Functions（advanced mode `_worker.js`） ─────────
// 与 Worker bundle 同一入口，仅输出为 Pages 的输出目录工作。
const pagesOutfile = join(pkgRoot, 'dist/pages/_worker.js');
await esbuild.build({
	entryPoints: [join(pkgRoot, 'src/runtime/worker.ts')],
	bundle: true,
	platform: 'neutral',
	format: 'esm',
	outfile: pagesOutfile,
	logLevel: 'warning',
	plugins: [bundleWorkspacePackages],
});
verifyNoWorkspaceExternals(pagesOutfile);
console.log('[tools-service/build] OK: pages bundle →', pagesOutfile);

// Pages 部署需要一个非空静态输出根；写入占位（所有路由仍由 _worker.js 接管）。
mkdirSync(join(pkgRoot, 'dist/pages'), { recursive: true });
writeFileSync(
	join(pkgRoot, 'dist/pages/index.html'),
	'<!doctype html><meta charset="utf-8"><title>Tools Service</title><p>Tools Service is handling requests via its Worker (see /v1/tools/*).</p>\n',
	'utf8'
);

/** 产物不得再含 `@cloud-api/*` 外部说明符。 */
function verifyNoWorkspaceExternals(outfile) {
	const source = readFileSync(outfile, 'utf8');
	const re = /(?:from\s+|import\s*\(\s*)["'](@cloud-api\/[^"']+)["']/g;
	const found = new Set();
	for (const m of source.matchAll(re)) {
		found.add(m[1]);
	}
	if (found.size > 0) {
		console.error('[tools-service/build] bundle still references @cloud-api/* as external:');
		for (const id of [...found].sort()) {
			console.error(`  ${id}`);
		}
		process.exit(1);
	}
}