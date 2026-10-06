import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "scut_admin_session";
export const SESSION_TTL_SECONDS = 7 * 24 * 3600;

export function randomToken() {
  return randomBytes(32).toString("base64url");
}

export function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function constantTimeEquals(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function readCookie(request, name) {
  const header = request.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

export function bearerToken(request) {
  const header = request.headers.authorization || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

export function clientIp(request) {
  return request.socket?.remoteAddress || "unknown";
}

export function sessionCookie(token, maxAgeSeconds = SESSION_TTL_SECONDS) {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`;
}

export function clearedSessionCookie() {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

/** 管理登录防爆破：同一 IP 连续失败 maxFails 次锁定 lockSeconds 秒 */
export function createRateLimiter({ maxFails = 5, lockSeconds = 600 } = {}) {
  const state = new Map();
  return {
    check(ip) {
      const entry = state.get(ip);
      if (entry && entry.until > Date.now()) {
        return { locked: true, retryAfter: Math.ceil((entry.until - Date.now()) / 1000) };
      }
      return { locked: false };
    },
    fail(ip) {
      const entry = state.get(ip) ?? { fails: 0, until: 0 };
      entry.fails += 1;
      if (entry.fails >= maxFails) {
        entry.until = Date.now() + lockSeconds * 1000;
        entry.fails = 0;
      }
      state.set(ip, entry);
    },
    reset(ip) {
      state.delete(ip);
    },
  };
}

/** 管理会话守卫：返回会话行或 null（Cookie → sha256 → 查库 → 比对过期时间） */
export async function requireAdmin(request, db, now = Date.now()) {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const row = await db.getAdminSession(sha256Hex(token));
  if (!row || row.expires_at < Math.floor(now / 1000)) return null;
  return row;
}

/** 客户端令牌守卫：返回令牌行或 null（并更新最近使用时间） */
export async function requireToken(request, db, now = Date.now()) {
  const token = bearerToken(request);
  if (!token) return null;
  const row = await db.getClientToken(token);
  if (!row || row.revoked_at !== null) return null;
  await db.touchClientToken(row.id);
  return row;
}
