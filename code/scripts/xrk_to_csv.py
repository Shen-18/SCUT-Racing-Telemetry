from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scut_telemetry.parser import export_racestudio_like_csv, load_telemetry


def main() -> int:
    parser = argparse.ArgumentParser(description="Convert AiM XRK/XRZ to RaceStudio-like CSV.")
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path, nargs="?")
    args = parser.parse_args()

    dataset = load_telemetry(args.input, fallback_csv=False)
    output = args.output or args.input.with_suffix(".export.csv")
    export_racestudio_like_csv(dataset, output)
    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
