from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scut_telemetry.parser import load_telemetry


def main() -> int:
    parser = argparse.ArgumentParser(description="Compare an XRK parse against a RaceStudio3 CSV export.")
    parser.add_argument("xrk", type=Path)
    parser.add_argument("csv", type=Path)
    parser.add_argument("--top", type=int, default=12)
    args = parser.parse_args()

    xrk = load_telemetry(args.xrk)
    csv_dataset = load_telemetry(args.csv)
    print(f"XRK: {xrk.frame.shape}, max time {xrk.max_time:.3f}s")
    print(f"CSV: {csv_dataset.frame.shape}, max time {csv_dataset.max_time:.3f}s")
    print(f"Column order match: {xrk.header_order == csv_dataset.header_order}")

    rows: list[tuple[float, float, str]] = []
    for channel in xrk.header_order:
        if channel == "Time" or channel not in csv_dataset.frame:
            continue
        n = min(len(xrk.frame), len(csv_dataset.frame))
        left = xrk.frame[channel].to_numpy(dtype=float)[:n]
        right = csv_dataset.frame[channel].to_numpy(dtype=float)[:n]
        diff = np.abs(left - right)
        rows.append((float(np.nanmax(diff)), float(np.nanmean(diff)), channel))
    rows.sort(reverse=True)
    print("\nLargest channel differences:")
    for max_abs, mean_abs, channel in rows[: args.top]:
        print(f"{channel:28s} max={max_abs:10.6f} mean={mean_abs:10.6f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
