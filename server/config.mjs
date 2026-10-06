export const DEFAULT_DATABASE_URL = "postgresql://scut:<DATABASE_PASSWORD>@127.0.0.1:5432/scut_telemetry";

const positiveInt = (value, fallback) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export function resolveServerConfig(env = process.env) {
  return {
    port: positiveInt(env.SCUT_SYNC_PORT, 8787),
    databaseUrl: String(env.SCUT_DATABASE_URL || DEFAULT_DATABASE_URL),
    host: String(env.SCUT_SYNC_HOST || "127.0.0.1"),
  };
}
