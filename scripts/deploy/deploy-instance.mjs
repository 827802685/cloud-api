#!/usr/bin/env node
/**
 * Redeploy an existing Cloudflare instance (env file already present).
 *
 * Usage (repo root):
 *   npm run deploy:cloudflare -- <instance> [options]
 *   node scripts/deploy/deploy-instance.mjs <instance> [options]
 *
 * Options:
 *   --migrate, -m       Run db:migrate:remote before deploy
 *   --migrate-only      Only remote D1 migrate
 *   --show-master-key   Print remote system_config.MASTER_KEY (no deploy)
 *   --help, -h
 *
 * 单 Worker 二合一：只部署 Admin Worker（含 Proxy 逻辑），不再单独部署 Proxy Worker。
 * Env file: cloudflare-worker/<instance>.env (gitignore)
 */
import { existsSync } from "node:fs";
import {
	assertWranglerLoggedIn,
	envPathForInstance,
	fetchRemoteMasterKey,
	log,
	logError,
	parseEnvFile,
	printLocalDevHint,
	runNpmWithEnv,
} from "./cf-deploy-lib.mjs";

function usage() {
	console.log(`Usage: npm run deploy:cloudflare -- <instance> [options]

Options:
  --migrate, -m       Run db:migrate:remote before deploy
  --migrate-only      Only remote D1 migrate
  --show-master-key   Print remote MASTER_KEY (no deploy)
  --help, -h          Show this help

单 Worker 二合一：只部署 Admin Worker（含 Proxy 逻辑）。

Example:
  npm run deploy:cloudflare -- mygw --migrate
`);
}

function main() {
	const argv = process.argv.slice(2);
	if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
		usage();
		process.exit(argv.length === 0 ? 1 : 0);
	}

	const instance = argv.find((a) => !a.startsWith("-"));
	if (!instance) {
		logError("instance name required");
		usage();
		process.exit(1);
	}

	let doMigrate = false;
	let doAdmin = true; // 单 Worker 二合一：Admin Worker 含 Proxy 逻辑
	let showMasterKey = false;

	for (const arg of argv) {
		if (arg === instance) {
			continue;
		}
		switch (arg) {
			case "--migrate":
			case "-m":
				doMigrate = true;
				break;
			case "--migrate-only":
				doMigrate = true;
				doAdmin = false;
				break;
			case "--show-master-key":
				showMasterKey = true;
				doAdmin = false;
				doMigrate = false;
				break;
			case "--help":
			case "-h":
				usage();
				process.exit(0);
				break;
			default:
				logError(`unknown option: ${arg}`);
				usage();
				process.exit(1);
		}
	}

	const envPath = envPathForInstance(instance);
	if (!existsSync(envPath)) {
		logError(`env file not found: ${envPath}`);
		logError(
			`Copy cloudflare-worker/example.env or run: npm run bootstrap:cloudflare`,
		);
		process.exit(1);
	}

	const vars = parseEnvFile(envPath);
	if (!vars.D1_DATABASE_ID || !vars.D1_DATABASE_NAME) {
		logError("D1_DATABASE_ID and D1_DATABASE_NAME are required in the env file");
		process.exit(1);
	}

	assertWranglerLoggedIn();

	log(`Instance: ${instance}`);
	log(`Config: cloudflare-worker/${instance}.env`);

	if (showMasterKey) {
		const key = fetchRemoteMasterKey(vars);
		if (!key) {
			logError("Could not read MASTER_KEY from remote D1");
			process.exit(1);
		}
		console.log(key);
		return;
	}

	if (doMigrate) {
		runNpmWithEnv(vars, ["db:migrate:remote"]);
	}
	if (doAdmin) {
		runNpmWithEnv(vars, ["deploy:admin"]);
	}

	log(`${instance} done.`);
	if (doAdmin) {
		printLocalDevHint();
	}
}

try {
	main();
} catch (err) {
	logError(err instanceof Error ? err.message : String(err));
	process.exit(1);
}
