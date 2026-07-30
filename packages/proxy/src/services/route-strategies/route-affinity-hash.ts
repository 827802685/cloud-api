/**
 * Affinity 路由打分：对 (affinityKey, providerId) 做稳定哈希，再按 weight 加权。
 * score = max(1, weight) / -ln(u)，u ∈ (0,1) 来自 FNV-1a。
 */

/** FNV-1a 32-bit。 */
export function fnv1a32(s: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		hash ^= s.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

/**
 * 计算 affinity 分数（越大越优先）。
 * u = (fnv1a32(affinityKey + '\\x1f' + providerId) + 0.5) / 2^32
 */
export function routeAffinityScore(affinityKey: string, providerId: string, weight: number): number {
	const h = fnv1a32(`${affinityKey}\x1f${providerId}`);
	const u = (h + 0.5) / 2 ** 32;
	return Math.max(1, weight) / -Math.log(u);
}
