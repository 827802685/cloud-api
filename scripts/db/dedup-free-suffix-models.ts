#!/usr/bin/env node
/**
 * 修复 RSS / 静态目录导入产生的 `:free` 后缀模型 ID 重复问题。
 *
 * 背景：RSS 同步与 free-models 静态目录曾用带 `:free` 后缀的 ID（如
 * `nvidia/nemotron-3-super-120b-a12b:free`）导入模型，而 nvidia.json 等目录用
 * 不带后缀的 ID（`nvidia/nemotron-3-super-120b-a12b`），导致同一模型在 `models`
 * 表出现两条记录，测试台/模型页重复展示。
 *
 * 本脚本对每个 `xxx:free` 模型：
 *   - 目标 `xxx` 已存在：把路由/标签迁移到 `xxx`（路由按 provider+model 去重），删除 `:free` 模型；
 *   - 目标 `xxx` 不存在：先复制模型为 `xxx`，再迁移路由/标签，删除 `:free` 模型。
 * 采用「先建目标、再迁子表、最后删旧」的顺序，避免外键约束问题。
 *
 * Usage:
 *   # D1（生产 Cloudflare，需已登录 wrangler）
 *   npx tsx scripts/db/dedup-free-suffix-models.ts --d1-source=remote
 *   # D1 本地
 *   npx tsx scripts/db/dedup-free-suffix-models.ts --d1-source=local
 *   # Postgres
 *   DATABASE_URL=postgres://... npx tsx scripts/db/dedup-free-suffix-models.ts --driver=postgres
 *
 * Env:
 *   DATABASE_URL       Postgres 连接串（--driver=postgres 时必填）
 *   D1_DATABASE_NAME   D1 数据库名（默认 octafuse-gateway）
 */
import postgres from 'postgres';
import {
	type D1ExecutionConfig,
	parseD1ExecutionConfig,
	runD1ExecuteJson,
	DEFAULT_D1_DATABASE_NAME,
	DEFAULT_D1_PERSIST_TO,
} from './lib/d1-execute';

interface Config {
	d1: D1ExecutionConfig;
	postgresUrl: string | null;
	driver: 'd1' | 'postgres';
}

function parseConfig(): Config {
	const args = process.argv.slice(2).filter((arg) => arg !== '--');
	if (args.includes('-h') || args.includes('--help')) {
		console.log(`Usage:
  npx tsx scripts/db/dedup-free-suffix-models.ts [--driver=d1|postgres] [--d1-source=remote|local] [--d1-persist-to=<path>]

Options:
  --driver=d1|postgres   Database driver (default: d1)
  --d1-source=remote|local   D1 source (default: remote)
  --d1-persist-to=<path>     Local D1 persist dir (default: ${DEFAULT_D1_PERSIST_TO})

Environment:
  DATABASE_URL           Postgres connection string (required for --driver=postgres)
  D1_DATABASE_NAME       D1 database name (default: ${DEFAULT_D1_DATABASE_NAME})
`);
		process.exit(0);
	}
	const driverArg = args.find((a) => a.startsWith('--driver='))?.split('=')[1];
	const driver = driverArg === 'postgres' ? 'postgres' : 'd1';
	const postgresUrl = process.env.DATABASE_URL?.trim() ?? null;
	if (driver === 'postgres' && !postgresUrl) {
		throw new Error('DATABASE_URL is required for --driver=postgres');
	}
	return { d1: parseD1ExecutionConfig(args), postgresUrl, driver };
}

function esc(value: string): string {
	return value.replace(/'/g, "''");
}

const MODELS_COLS =
	'id, display_name, vendor, context_window, max_tokens, pricing_profile, description, metadata, input_modalities, output_modalities, released_at, route_policy, created_at';

/** 找出所有带 `:free` 后缀的模型 ID。 */
function listFreeSuffixIds(d1: D1ExecutionConfig): string[] {
	const rows = runD1ExecuteJson(`SELECT id FROM models WHERE id LIKE '%:free'`, d1);
	return rows.map((r) => String(r.id));
}

async function fixD1(config: D1ExecutionConfig): Promise<{ renamed: number; merged: number }> {
	const ids = listFreeSuffixIds(config);
	let renamed = 0;
	let merged = 0;
	for (const id of ids) {
		const target = id.slice(0, -':free'.length);
		const targetExists =
			runD1ExecuteJson(`SELECT 1 FROM models WHERE id = '${esc(target)}'`, config).length > 0;
		if (targetExists) {
			// 目标已存在：迁移路由（按 provider+model 去重），删除剩余路由，迁移标签，删除旧模型
			runD1ExecuteJson(
				`UPDATE model_routes SET model_id = '${esc(target)}' WHERE model_id = '${esc(id)}' AND NOT EXISTS (SELECT 1 FROM model_routes r2 WHERE r2.model_id = '${esc(target)}' AND r2.provider_id = model_routes.provider_id AND r2.provider_model_name = model_routes.provider_model_name)`,
				config
			);
			runD1ExecuteJson(`DELETE FROM model_routes WHERE model_id = '${esc(id)}'`, config);
			runD1ExecuteJson(
				`INSERT OR IGNORE INTO model_tags (model_id, tag) SELECT '${esc(target)}', tag FROM model_tags WHERE model_id = '${esc(id)}'`,
				config
			);
			runD1ExecuteJson(`DELETE FROM models WHERE id = '${esc(id)}'`, config);
			merged++;
		} else {
			// 目标不存在：先复制模型为 target，再迁移子表，最后删除旧模型
			runD1ExecuteJson(
				`INSERT INTO models (${MODELS_COLS}) SELECT '${esc(target)}', display_name, vendor, context_window, max_tokens, pricing_profile, description, metadata, input_modalities, output_modalities, released_at, route_policy, created_at FROM models WHERE id = '${esc(id)}'`,
				config
			);
			runD1ExecuteJson(`UPDATE model_routes SET model_id = '${esc(target)}' WHERE model_id = '${esc(id)}'`, config);
			runD1ExecuteJson(`UPDATE model_tags SET model_id = '${esc(target)}' WHERE model_id = '${esc(id)}'`, config);
			runD1ExecuteJson(`DELETE FROM models WHERE id = '${esc(id)}'`, config);
			renamed++;
		}
	}
	return { renamed, merged };
}

async function fixPostgres(url: string): Promise<{ renamed: number; merged: number }> {
	const sql = postgres(url, { max: 1 });
	try {
		await sql`SET search_path TO octafuse_gateway`;
		const rows = await sql`SELECT id FROM models WHERE id LIKE '%:free'`;
		let renamed = 0;
		let merged = 0;
		for (const row of rows) {
			const id = String(row.id);
			const target = id.slice(0, -':free'.length);
			const targetExists = await sql`SELECT 1 FROM models WHERE id = ${target}`;
			if (targetExists.length > 0) {
				await sql`
					UPDATE model_routes SET model_id = ${target}
					WHERE model_id = ${id}
					  AND NOT EXISTS (
						SELECT 1 FROM model_routes r2
						WHERE r2.model_id = ${target}
						  AND r2.provider_id = model_routes.provider_id
						  AND r2.provider_model_name = model_routes.provider_model_name
					  )
				`;
				await sql`DELETE FROM model_routes WHERE model_id = ${id}`;
				await sql`
					INSERT INTO model_tags (model_id, tag)
					SELECT ${target}, tag FROM model_tags WHERE model_id = ${id}
					ON CONFLICT (model_id, tag) DO NOTHING
				`;
				await sql`DELETE FROM models WHERE id = ${id}`;
				merged++;
			} else {
				await sql`
					INSERT INTO models (${sql(MODELS_COLS)})
					SELECT ${target}, display_name, vendor, context_window, max_tokens, pricing_profile, description, metadata, input_modalities, output_modalities, released_at, route_policy, created_at
					FROM models WHERE id = ${id}
				`;
				await sql`UPDATE model_routes SET model_id = ${target} WHERE model_id = ${id}`;
				await sql`UPDATE model_tags SET model_id = ${target} WHERE model_id = ${id}`;
				await sql`DELETE FROM models WHERE id = ${id}`;
				renamed++;
			}
		}
		return { renamed, merged };
	} finally {
		await sql.end({ timeout: 5 });
	}
}

async function main(): Promise<void> {
	const config = parseConfig();
	if (config.driver === 'postgres') {
		const result = await fixPostgres(config.postgresUrl!);
		console.log(
			`[dedup-free-suffix] postgres done: renamed=${result.renamed}, merged=${result.merged}`
		);
	} else {
		const result = await fixD1(config.d1);
		console.log(
			`[dedup-free-suffix] d1(${config.d1.source}) done: renamed=${result.renamed}, merged=${result.merged}`
		);
	}
}

main().catch((err) => {
	console.error('[dedup-free-suffix] failed:', err instanceof Error ? err.message : err);
	process.exit(1);
});
