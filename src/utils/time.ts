// 时间显示格式（DESIGN-SPEC 4.5：HUD/时间轴/详情 m:ss.mmm）
// t 为秒；负值按 0 处理；非有限值返回占位。

export function formatClockTime(t: number, msDigits = 3): string {
  if (!Number.isFinite(t)) return "--:--." + "0".repeat(Math.max(0, Math.min(3, msDigits)));
  const clamped = Math.max(0, t);
  const m = Math.floor(clamped / 60);
  const s = clamped - m * 60;
  const secText = s.toFixed(msDigits).padStart(msDigits + 3, "0");
  return `${m}:${secText}`;
}

export function formatDurationShort(t: number): string {
  if (!Number.isFinite(t) || t < 0) return "--:--.-";
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

// 资料库用：unix 秒 → 本地 "YYYY-MM-DD HH:mm"（manifest mtime 为源文件时间）
export function formatDateTime(unixSecs: number): string {
  if (!Number.isFinite(unixSecs) || unixSecs <= 0) return "—";
  const d = new Date(unixSecs * 1000);
  if (Number.isNaN(d.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
