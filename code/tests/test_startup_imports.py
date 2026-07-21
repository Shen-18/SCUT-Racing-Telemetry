from __future__ import annotations

import json
import subprocess
import sys


def test_app_import_does_not_eagerly_load_telemetry_data_stack() -> None:
    code = """
import json
import sys
import scut_telemetry.app  # noqa: F401
print(json.dumps({
    name: (name in sys.modules)
    for name in [
        'pandas',
        'numpy',
        'scut_telemetry.parser',
        'scut_telemetry.analyzer',
    ]
}))
"""
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=".",
        check=True,
        text=True,
        capture_output=True,
    )
    loaded = json.loads(result.stdout)
    assert loaded == {
        "pandas": False,
        "numpy": False,
        "scut_telemetry.parser": False,
        "scut_telemetry.analyzer": False,
    }
