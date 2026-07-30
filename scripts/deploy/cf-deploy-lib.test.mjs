import assert from "node:assert/strict";
import test from "node:test";
import { runNpmWithEnv, runWrangler } from "./cf-deploy-lib.mjs";

test("runWrangler starts the local CLI and captures its version", () => {
	const { stdout } = runWrangler(["--version"], {
		capture: true,
		env: {
			WRANGLER_SEND_METRICS: "false",
		},
	});

	assert.match(stdout.trim(), /^\d+\.\d+\.\d+$/);
});

test("runNpmWithEnv starts npm without a platform-specific shim", () => {
	assert.doesNotThrow(() => runNpmWithEnv({}, ["--version"]));
});
