/**
 * Gateway Admin 后台会话：随机 token + 过期时间用 `MASTER_KEY` 做 HMAC-SHA256 签名后写入 `admin_session` cookie。
 * `checkAuth` 验证 cookie 的签名与有效期，防止伪造 cookie 绕过身份验证。
 */

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24h

/** 生成 32 字节十六进制会话标识。 */
export function generateSessionToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * 是否为 `admin_session` 设置 `Secure`（可选加固，由 `ADMIN_COOKIE_SECURE` 控制）。
 * - 未设置或 `0`/`false`/`no`/`off` → false（默认；明文 HTTP 可登录）
 * - `1`/`true`/`yes`/`on` → true（已部署 HTTPS 时可选用，限制 Cookie 仅经 HTTPS 回传）
 */
export function resolveCookieSecure(): boolean {
  const raw = process.env.ADMIN_COOKIE_SECURE?.trim().toLowerCase();
  if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') {
    return true;
  }
  return false;
}

/** 用 `MASTER_KEY` 计算 HMAC-SHA256 十六进制摘要。 */
async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig), b => b.toString(16).padStart(2, '0')).join('');
}

/** 恒定时比较（避免定时侧信道泄露前缀）。 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * 生成签名会话 cookie 值：`<token>.<expiresAtMs>.<hmac>`。
 * `hmac = HMAC-SHA256(masterKey, `${token}.${expiresAtMs}`)`。
 * 无状态：无需数据库存储，验证时用 masterKey 重算签名对比。
 */
export async function createSessionCookieValue(
  masterKey: string,
  now = Date.now()
): Promise<string> {
  const token = generateSessionToken();
  const expiresAtMs = now + SESSION_TTL_MS;
  const signature = await hmacSha256Hex(masterKey, `${token}.${expiresAtMs}`);
  return `${token}.${expiresAtMs}.${signature}`;
}

/**
 * 验证签名会话 cookie 值。
 * - 结构必须为 3 段（token.expiresAtMs.signature）
 * - 签名必须与 masterKey 重算结果一致（恒定时比较）
 * - 未过期
 */
export async function verifySessionCookieValue(
  cookieValue: string | null | undefined,
  masterKey: string,
  now = Date.now()
): Promise<boolean> {
  if (!cookieValue) return false;
  const parts = cookieValue.split('.');
  if (parts.length !== 3) return false;
  const [token, expiresAtStr, signature] = parts as [string, string, string];
  const expiresAtMs = Number(expiresAtStr);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now) return false;
  const expected = await hmacSha256Hex(masterKey, `${token}.${expiresAtStr}`);
  return constantTimeEqual(signature, expected);
}

/** 从请求头 Cookie 中提取 `admin_session` 的值（无则 null）。 */
export function getSessionCookieValue(request: Request): string | null {
  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith('admin_session=')) {
      return trimmed.slice('admin_session='.length);
    }
  }
  return null;
}

/**
 * 校验请求是否携带有效 `admin_session` cookie（签名 + 有效期）。
 * @deprecated 请使用 {@link verifySessionCookieValue} + {@link getSessionCookieValue}，以显式传入 masterKey。
 */
export async function checkAuth(request: Request, masterKey: string): Promise<boolean> {
  return verifySessionCookieValue(getSessionCookieValue(request), masterKey);
}
