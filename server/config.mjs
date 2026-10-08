import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const localEnvironment = fileURLToPath(new URL("../.secrets/server.env", import.meta.url));

const positiveInt = (value, fallback) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export function resolveServerConfig(env = process.env) {
  if (env === process.env && existsSync(localEnvironment)) process.loadEnvFile(localEnvironment);
  const databaseUrl = String(env.SCUT_DATABASE_URL || "").trim();
  if (!databaseUrl) throw new Error("请在本地 .secrets/server.env 或服务器环境变量中配置 SCUT_DATABASE_URL");
  return {
    port: positiveInt(env.SCUT_SYNC_PORT, 8787),
    databaseUrl,
    host: String(env.SCUT_SYNC_HOST || "127.0.0.1"),
    adminPassword: String(env.SCUT_ADMIN_PASSWORD || ""),
  };
}
