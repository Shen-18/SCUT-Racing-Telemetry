// 通道固定色板（DESIGN-SPEC 2.3 / 手册附录 B.1 rev.5）
// 色条 → 曲线 → 图例 → 详情色条四处联动，全部引用本模块返回值。
// SPEED 是"前景色通道"：返回 var(--text)，随主题反转（深色白、浅色 #15151E）；
// 其余通道色两主题同色。未匹配通道从保留池顺序取色并记入分配表，
// 分配表按数据集通道全序构建（与勾选状态无关），保证确定性。

export const SPEED_COLOR = "var(--text)";

const POOL = ["#3A9BFF", "#FF5D8F", "#00D9B0"] as const;

interface NamedRule {
  pattern: RegExp;
  color: string;
}

// 命中顺序即数组顺序；distance 通道虽含 "speed" 字样但不是速度曲线，
// 已在 matchNamedChannelColor 中显式排除。
const NAMED_RULES: readonly NamedRule[] = [
  { pattern: /speed/i, color: SPEED_COLOR },
  { pattern: /rpm/i, color: "#B14BF4" },
  { pattern: /throttle/i, color: "#43B02A" },
  { pattern: /brake/i, color: "#E10600" },
  { pattern: /steer/i, color: "#28F3D2" },
  { pattern: /gear/i, color: "#FFD100" },
  { pattern: /lat.?g\b|lateral/i, color: "#FF8001" },
];

export function matchNamedChannelColor(name: string): string | null {
  if (/distance/i.test(name)) return null;
  for (const rule of NAMED_RULES) {
    if (rule.pattern.test(name)) return rule.color;
  }
  return null;
}

export function buildChannelColorMap(names: readonly string[]): Record<string, string> {
  const map: Record<string, string> = {};
  let poolIdx = 0;
  for (const name of names) {
    if (name in map) continue;
    const named = matchNamedChannelColor(name);
    map[name] = named ?? POOL[poolIdx++ % POOL.length];
  }
  return map;
}
