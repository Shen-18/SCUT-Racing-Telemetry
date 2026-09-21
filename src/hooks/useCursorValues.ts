import { useEffect, useRef, useState } from "react";
import * as client from "../api/client";

// 游标取值 hook（B.9：CursorValues 节流 ≤20 次/s）。
// 100ms 轮询 + 在途防重入：游标静止或值未变化时不发请求；
// 返回每个通道在 cursorT 时刻的取值（t 超出数据时长时不请求）。

export function useCursorValues(
  datasetId: number | null,
  channels: readonly string[],
  cursorT: number,
  duration: number,
  intervalMs = 100
): Record<string, number> {
  const [values, setValues] = useState<Record<string, number>>({});
  const latestRef = useRef({ cursorT, duration });
  latestRef.current = { cursorT, duration };
  const channelKey = channels.join("\u0000");

  useEffect(() => {
    if (datasetId === null || channels.length === 0) {
      setValues({});
      return;
    }
    const keys = channelKey.split("\u0000");
    let inFlight = false;
    let lastT = Number.NaN;
    const timer = globalThis.setInterval(() => {
      if (inFlight) return;
      const { cursorT: t, duration: dur } = latestRef.current;
      if (!Number.isFinite(t) || t < 0 || t > dur || t === lastT) return;
      inFlight = true;
      lastT = t;
      client
        .cursorValues(datasetId, keys, t)
        .then((list) => {
          inFlight = false;
          if (latestRef.current.cursorT !== t) return; // 已过期，等下一轮
          const next: Record<string, number> = {};
          keys.forEach((key, index) => {
            next[key] = list[index];
          });
          setValues(next);
        })
        .catch(() => {
          inFlight = false;
        });
    }, intervalMs);
    return () => {
      globalThis.clearInterval(timer);
    };
  }, [datasetId, channelKey, intervalMs]);

  return values;
}
