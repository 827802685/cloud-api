#!/usr/bin/env node
/**
 * 校验 proxy Node bundle 不含 `@cloud-api/*` 外部说明符。
 * workspace 包应被 esbuild 打进产物（见 packages/proxy/scripts/build.mjs）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '../..');
const bundlePath = join(root, 'packages/proxy/dist/runtime/node.js');

if (!existsSync(bundlePath)) {
	console.error(
		`[verify-proxy-bundle-externals] missing ${bundlePath}; run: npm run build -w @cloud-api/proxy`,
	);
	process.exit(1);
}

const source = readFileSync(bundlePath, 'utf8');
/** 匹配 from/import 中的 `@cloud-api/...` 说明符（含动态 import）。 */
const re = /(?:from\s+|import\s*\(\s*)["'](@octafuse\/[^"']+)["']/g;
const found = new Set();
for (const m of source.matchAll(re)) {
	found.add(m[1]);
}

if (found.size > 0) {
	console.error(
		'[verify-proxy-bundle-externals] bundle still references @cloud-api/* as external:',
	);
	for (const id of [...found].sort()) {
		console.error(`  ${id}`);
	}
	process.exit(1);
}

console.log('[verify-proxy-bundle-externals] OK: no @cloud-api/* externals in proxy bundle');
