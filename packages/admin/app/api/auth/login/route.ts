/**
 * 后台登录：`POST` 校验 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 后写入 `admin_session`（httpOnly）。
 * `DELETE` 与 `/api/auth/logout` 类似，用于清除会话（兼容旧客户端可一并保留）。
 */
import { createSessionCookieValue, resolveCookieSecure } from '@/lib/auth';
import { getMasterKey } from '@/lib/services/admin/master-key-service';
import { resolveAdminStorageContext } from '@/lib/storage-context';
import { getCloudflareEnv } from '@/lib/cloudflare';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

interface LoginRequest {
  username: string;
  password: string;
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as LoginRequest;
    const { username, password } = body;

    // 凭据与 DB 绑定来自 OpenNext env；本地 dev 回退 process.env
    const cfEnv = getCloudflareEnv(request);
    const adminUsername = cfEnv?.ADMIN_USERNAME || process.env.ADMIN_USERNAME;
    const adminPassword = cfEnv?.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD;

    if (!adminUsername || !adminPassword) {
      console.error('Admin credentials not configured');
      return Response.json(
        { success: false, message: 'Server configuration error' },
        { status: 500 }
      );
    }

    if (username !== adminUsername || password !== adminPassword) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      return Response.json(
        { success: false, message: 'Invalid credentials' },
        { status: 401 }
      );
    }

    // 读取 MASTER_KEY 用于签名会话 cookie（无状态验证，防止伪造 cookie 绕过）
    let masterKey: string | null = null;
    try {
      // 必须把 Cloudflare 的 DB 绑定传给存储上下文，否则无法读取 system_config.MASTER_KEY
      const bindings = cfEnv?.DB
        ? {
            DB: cfEnv.DB,
            ASSETS: cfEnv.ASSETS,
            DATABASE_DRIVER: cfEnv.DATABASE_DRIVER,
          }
        : undefined;
      const storage = await resolveAdminStorageContext(bindings, cfEnv?.DB ? 'cloudflare' : 'auto');
      masterKey = await getMasterKey(storage.repositories);
    } catch (error) {
      console.error('Failed to load MASTER_KEY for session signing:', error);
    }
    if (!masterKey) {
      return Response.json(
        { success: false, message: 'Server configuration error: MASTER_KEY not set' },
        { status: 500 }
      );
    }

    const sessionCookieValue = await createSessionCookieValue(masterKey);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const cookieStore = await cookies();
    cookieStore.set('admin_session', sessionCookieValue, {
      httpOnly: true,
      secure: resolveCookieSecure(),
      sameSite: 'strict',
      expires: expiresAt,
      path: '/',
    });

    return Response.json({
      success: true,
      message: 'Login successful',
    });

  } catch (error) {
    console.error('Login API error:', error);
    return Response.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    const cookieStore = await cookies();
    cookieStore.delete('admin_session');

    return Response.json({
      success: true,
      message: 'Logout successful',
    });
  } catch (error) {
    console.error('Logout API error:', error);
    return Response.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    );
  }
}
