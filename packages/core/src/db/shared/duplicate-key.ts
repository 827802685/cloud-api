/**
 * 跨方言重复键（唯一约束冲突）错误检测。
 * 用于 `ensureModelSurfacePool` 等 SELECT-then-INSERT 模式在并发下的 TOCTOU 修复：
 * 第二个并发请求命中唯一约束时，忽略该错误并重新读取权威行，而不是把原始 500 抛给调用方。
 */

/** D1 / SQLite：`UNIQUE constraint failed: ...` 或 `constraint failed` */
export function isD1DuplicateKeyError(err: unknown): boolean {
	const msg = err instanceof Error ? err.message : String(err);
	return msg.includes('UNIQUE constraint failed') || msg.includes('constraint failed');
}

/** PostgreSQL：SQLSTATE 23505 unique_violation */
export function isPgDuplicateKeyError(err: unknown): boolean {
	const code = (err as { code?: string } | null)?.code;
	if (code === '23505') return true;
	const msg = err instanceof Error ? err.message : String(err);
	return msg.includes('duplicate key value violates unique constraint');
}

/** MySQL：ER_DUP_ENTRY（1062） */
export function isMysqlDuplicateKeyError(err: unknown): boolean {
	const code = (err as { code?: string } | null)?.code;
	if (code === 'ER_DUP_ENTRY' || code === '1062') return true;
	const msg = err instanceof Error ? err.message : String(err);
	return msg.includes('Duplicate entry');
}
