import { createD1StorageContext, resolveWorkerDatabaseConfig, type StorageContext, type GatewayEnv } from '@cloud-api/core';
import type { Context } from 'hono';
import { createProxyApp } from '../app';

async function resolveWorkersStorage(context: Context<GatewayEnv>): Promise<StorageContext> {
	const config = resolveWorkerDatabaseConfig(context.env);
	return createD1StorageContext(config.db);
}

export const workerApp = createProxyApp(resolveWorkersStorage, {
	beforeAll: (c, next) => {
		resolveWorkerDatabaseConfig(c.env);
		return next();
	},
});
