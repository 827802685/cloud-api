import createNextIntlPlugin from 'next-intl/plugin';
import path from 'path';
import { fileURLToPath } from 'url';

const withNextIntl = createNextIntlPlugin('./lib/i18n.ts');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** npm workspace 根（`octafuse/`），与 hoist 的 `next` 一致 */
const workspaceRoot = path.join(__dirname, '../..');

const proxyServicesRoot = path.join(__dirname, '../proxy/src/services');
/** Admin/OpenNext 的 `node` 条件会解析到过期的 `core/dist`；Playground Tools 拉入 proxy 源码时改走 src。 */
const coreSrcIndex = path.join(__dirname, '../core/src/index.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
	output: 'standalone',
	transpilePackages: ['@octafuse/core'],
	images: {
		unoptimized: true,
	},
	// 与 `turbopack.root` 必须相同（npm workspaces 下 Next 会从 monorepo 根解析 `next`）
	outputFileTracingRoot: workspaceRoot,
	turbopack: {
		root: workspaceRoot,
		resolveAlias: {
			'@octafuse/proxy-services': proxyServicesRoot,
		},
	},
	webpack: (config) => {
		config.resolve.alias = {
			...config.resolve.alias,
			'@octafuse/proxy-services': proxyServicesRoot,
			// Exact match (`$`) so `@octafuse/core/lib/...` still uses package exports → src.
			// Avoids OpenNext/webpack `node` condition resolving a stale `core/dist`.
			'@octafuse/core$': coreSrcIndex,
		};
		return config;
	},
};

export default withNextIntl(nextConfig);
