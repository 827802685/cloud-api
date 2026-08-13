/**
 * Tencent Cloud API 3.0 TC3-HMAC-SHA256（POST JSON）。
 * 使用 WebCrypto（crypto.subtle），兼容 Cloudflare Workers 与 Node 18+。
 * 算法对齐 soloent-web `lib/tencent/tc3-sign.ts`（原 node:crypto 版）。
 */

/**
 * 解析 WebCrypto 实例：Cloudflare Workers / Node 19+ 直接使用全局 `crypto.subtle`；
 * Node 18 的 `globalThis.crypto` 需 `--experimental-global-webcrypto`，故回退到 `node:crypto` 的 `webcrypto`。
 * 惰性解析并缓存，避免每次签名重复 import。
 */
let webcryptoPromise: Promise<Crypto> | null = null;

function getWebCrypto(): Promise<Crypto> {
	if (!webcryptoPromise) {
		webcryptoPromise = (async () => {
			const g = globalThis as { crypto?: { subtle?: SubtleCrypto } };
			if (typeof g !== 'undefined' && g.crypto?.subtle) {
				return g.crypto as Crypto;
			}
			const nodeCrypto = (await import('node:crypto')) as unknown as {
				webcrypto?: { subtle?: SubtleCrypto };
			};
			if (nodeCrypto?.webcrypto?.subtle) {
				return nodeCrypto.webcrypto as Crypto;
			}
			throw new Error('WebCrypto (crypto.subtle) is not available in this runtime');
		})();
	}
	return webcryptoPromise;
}

export type Tc3SignResult = {
	authorization: string;
	timestamp: string;
};

function toHex(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let out = '';
	for (let i = 0; i < bytes.length; i++) {
		out += bytes[i]!.toString(16).padStart(2, '0');
	}
	return out;
}

async function sha256Hex(message: string): Promise<string> {
	const webcrypto = await getWebCrypto();
	const data = new TextEncoder().encode(message);
	const digest = await webcrypto.subtle.digest('SHA-256', data);
	return toHex(digest);
}

async function hmacSha256(
	key: ArrayBuffer | Uint8Array | string,
	message: string
): Promise<ArrayBuffer> {
	const webcrypto = await getWebCrypto();
	const keyBytes =
		typeof key === 'string' ? new TextEncoder().encode(key) : key instanceof Uint8Array ? key : new Uint8Array(key);
	const cryptoKey = await webcrypto.subtle.importKey(
		'raw',
		keyBytes as BufferSource,
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	return webcrypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message));
}

/** Tencent Cloud API 3.0 TC3-HMAC-SHA256 signature (POST JSON) */
export async function signTc3Request(params: {
	secretId: string;
	secretKey: string;
	service: string;
	host: string;
	payload: string;
	timestamp?: number;
}): Promise<Tc3SignResult> {
	const timestamp = params.timestamp ?? Math.floor(Date.now() / 1000);
	const date = new Date(timestamp * 1000).toISOString().slice(0, 10);

	const canonicalHeaders = `content-type:application/json\nhost:${params.host}\n`;
	const signedHeaders = 'content-type;host';
	const hashedRequestPayload = await sha256Hex(params.payload);

	const canonicalRequest = [
		'POST',
		'/',
		'',
		canonicalHeaders,
		signedHeaders,
		hashedRequestPayload,
	].join('\n');

	const credentialScope = `${date}/${params.service}/tc3_request`;
	const stringToSign = [
		'TC3-HMAC-SHA256',
		String(timestamp),
		credentialScope,
		await sha256Hex(canonicalRequest),
	].join('\n');

	const secretDate = await hmacSha256(`TC3${params.secretKey}`, date);
	const secretService = await hmacSha256(secretDate, params.service);
	const secretSigning = await hmacSha256(secretService, 'tc3_request');
	const signature = toHex(await hmacSha256(secretSigning, stringToSign));

	const authorization =
		`TC3-HMAC-SHA256 Credential=${params.secretId}/${credentialScope}, ` +
		`SignedHeaders=${signedHeaders}, Signature=${signature}`;

	return { authorization, timestamp: String(timestamp) };
}
