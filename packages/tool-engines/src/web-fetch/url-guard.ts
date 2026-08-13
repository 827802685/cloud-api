/**
 * Web Fetch URL 校验（SSRF 精简版）：仅检查字面量 host / IP，不做 DNS lookup（Worker 上不可靠且慢）。
 */

export type UrlGuardOk = { ok: true; url: string; hostname: string };
export type UrlGuardFail = { ok: false; error: string };
export type UrlGuardResult = UrlGuardOk | UrlGuardFail;

/**
 * 校验目标 URL：仅允许 http/https；拒绝 localhost / 私网字面量 / 元数据 host。
 */
export function assertFetchUrlSafe(raw: string): UrlGuardResult {
	const trimmed = raw?.trim() ?? '';
	if (!trimmed) {
		return { ok: false, error: 'url is required' };
	}

	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		return { ok: false, error: 'url is invalid' };
	}

	const protocol = parsed.protocol.toLowerCase();
	if (protocol !== 'http:' && protocol !== 'https:') {
		return { ok: false, error: 'url must use http or https' };
	}

	const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
	if (!hostname) {
		return { ok: false, error: 'url hostname is required' };
	}

	if (isBlockedHost(hostname)) {
		return { ok: false, error: 'url host is not allowed' };
	}

	return { ok: true, url: parsed.toString(), hostname };
}

/**
 * 将 IPv4-mapped IPv6 尾部还原为点分 IPv4。
 * WHATWG URL 解析器会把 `[::ffff:127.0.0.1]` 规范化为十六进制 `[::ffff:7f00:1]`，
 * 因此需要同时兼容点分与十六进制两种写法。
 */
function ipv4MappedToIpv4(host: string): string | null {
	const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(host);
	if (dotted) return dotted[1];
	const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(host);
	if (hex) {
		const hi = parseInt(hex[1], 16);
		const lo = parseInt(hex[2], 16);
		return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
	}
	return null;
}

function isBlockedHost(hostname: string): boolean {
	const host = hostname.toLowerCase().replace(/\.+$/, '');
	if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
		return true;
	}
	if (
		host === '0.0.0.0' ||
		host === '127.0.0.1' ||
		host === '::1' ||
		host === '0' ||
		host === 'metadata.google.internal' ||
		host.endsWith('.internal') ||
		host.endsWith('.localdomain')
	) {
		return true;
	}
	if (host.includes(':')) {
		if (
			host === '::' ||
			host === '::1' ||
			host.startsWith('fc') ||
			host.startsWith('fd') ||
			host.startsWith('fe80:')
		) {
			return true;
		}
	}
	// IPv4-mapped IPv6（`::ffff:a.b.c.d` 或规范化后的 `::ffff:xxxx:xxxx`）还原为 IPv4 后检查
	const mappedIpv4 = ipv4MappedToIpv4(host);
	if (mappedIpv4 && isBlockedIpv4(mappedIpv4)) {
		return true;
	}
	if (isBlockedIpv4(host)) {
		return true;
	}
	return false;
}

function isBlockedIpv4(host: string): boolean {
	const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
	if (!ipv4) {
		return false;
	}
	const a = Number(ipv4[1]);
	const b = Number(ipv4[2]);
	const c = Number(ipv4[3]);
	const d = Number(ipv4[4]);
	if ([a, b, c, d].some((n) => n > 255)) {
		return true;
	}
	if (a === 10 || a === 127 || a === 0) {
		return true;
	}
	if (a === 169 && b === 254) {
		return true;
	}
	if (a === 172 && b >= 16 && b <= 31) {
		return true;
	}
	if (a === 192 && b === 168) {
		return true;
	}
	if (a === 100 && b >= 64 && b <= 127) {
		return true;
	}
	return false;
}
