#!/usr/bin/env node
/**
 * Generate wrangler.jsonc / wrangler.d1.jsonc from *.base.jsonc + environment variables.
 *
 * Build variables (Workers Builds) or cloudflare-worker/*.env — see docs/operators/deployment/cloudflare.md
 *
 * Local D1 identity (important):
 * - Without D1_DATABASE_ID in env → generated configs have no database_id → local dev uses D1 "(DB)".
 * - With D1_DATABASE_ID (remote deploy / db:migrate:remote) → local wrangler dev uses a *different*
 *   SQLite under .wrangler/state than npm run db:migrate (default local path).
 * After any remote deploy on this machine, run `npm run gen:wrangler` (no D1_DATABASE_ID in shell)
 * before dev:admin. See docs/developers/local-development.md §1.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

const REMOTE = process.argv.includes("--remote");

function trimEnv(key) {
	const v = process.env[key];
	return typeof v === "string" ? v.trim() : "";
}

function resolveNames() {
	const d1DatabaseName =
		trimEnv("D1_DATABASE_NAME") || "cloud-api";

	return {
		adminWorkerName:
			trimEnv("ADMIN_WORKER_NAME") || "cloud-api-admin",
		d1MigrationsWorkerName:
			trimEnv("D1_MIGRATIONS_WORKER_NAME") ||
			"cloud-api-d1-migrations",
		d1DatabaseName,
		d1DatabaseId: trimEnv("D1_DATABASE_ID"),
		adminCustomDomain: trimEnv("ADMIN_CUSTOM_DOMAIN") || "",
	};
}

/** Strip // and block comments so JSONC base templates parse. Ignores `//` inside string literals (e.g. URLs). */
function parseJsonc(text) {
	const withoutBlock = text.replace(/\/\*[\s\S]*?\*\//g, "");
	const lines = withoutBlock.split("\n").map((line) => {
		// 逐字符扫描，跳过字符串字面量内部的 `//`，仅剥离真正的行注释
		let inString = false;
		let quote = "";
		for (let i = 0; i < line.length - 1; i++) {
			const ch = line[i];
			const next = line[i + 1];
			if (inString) {
				if (ch === "\\") {
					i++; // 跳过转义字符
					continue;
				}
				if (ch === quote) {
					inString = false;
				}
				continue;
			}
			if (ch === '"' || ch === "'") {
				inString = true;
				quote = ch;
				continue;
			}
			if (ch === "/" && next === "/") {
				return line.slice(0, i);
			}
		}
		return line;
	});
	return JSON.parse(lines.join("\n"));
}

function readBase(relativePath) {
	const path = join(ROOT, relativePath);
	return parseJsonc(readFileSync(path, "utf8"));
}

function writeJson(relativePath, data) {
	const path = join(ROOT, relativePath);
	writeFileSync(path, `${JSON.stringify(data, null, "\t")}\n`, "utf8");
	console.log(`gen-wrangler: wrote ${relativePath}`);
}

function applyD1Binding(binding, databaseName, databaseId) {
	const next = { ...binding, database_name: databaseName };
	if (databaseId) {
		next.database_id = databaseId;
	} else {
		delete next.database_id;
	}
	return next;
}

function customDomainRoutes(domain) {
	if (!domain) {
		return undefined;
	}
	return [{ pattern: domain, custom_domain: true }];
}

function generateAdmin(names) {
	const base = readBase("packages/admin/wrangler.base.jsonc");
	const config = {
		...base,
		name: names.adminWorkerName,
		d1_databases: [
			applyD1Binding(
				base.d1_databases[0],
				names.d1DatabaseName,
				names.d1DatabaseId,
			),
		],
	};

	const routes = customDomainRoutes(names.adminCustomDomain);
	if (routes) {
		config.routes = routes;
	} else {
		delete config.routes;
	}

	writeJson("packages/admin/wrangler.jsonc", config);
}

function generateD1(names) {
	const base = readBase("packages/core/wrangler.d1.base.jsonc");
	const config = {
		...base,
		name: names.d1MigrationsWorkerName,
		d1_databases: [
			applyD1Binding(
				base.d1_databases[0],
				names.d1DatabaseName,
				names.d1DatabaseId,
			),
		],
	};

	writeJson("packages/core/wrangler.d1.jsonc", config);
}

function validateRemote(names) {
	if (names.d1DatabaseId) {
		return;
	}
	console.error(
		"gen-wrangler: D1_DATABASE_ID is required for remote deploy/migrate.\n" +
			"  Set it in Workers Builds › Build variables, or:\n" +
			"  npx dotenv -e ./cloudflare-worker/<instance>.env -- npm run gen:wrangler -- --remote",
	);
	process.exit(1);
}

function main() {
	const names = resolveNames();

	if (REMOTE) {
		validateRemote(names);
	}

	generateAdmin(names);
	generateD1(names);

	console.log(
		`gen-wrangler: admin=${names.adminWorkerName} d1=${names.d1DatabaseName}` +
			(names.d1DatabaseId ? ` id=${names.d1DatabaseId}` : " (local, no database_id)"),
	);

	if (REMOTE && names.d1DatabaseId) {
		console.warn(
			"gen-wrangler: remote config written (includes database_id). " +
				"Before local dev:admin, run `npm run gen:wrangler` without D1_DATABASE_ID in the shell.",
		);
	}
}

main();
