from __future__ import annotations

import json
import sys
from dataclasses import dataclass
from pathlib import Path


@dataclass
class DisplayProfile:
    base_font: int = 12
    title_font: int = 16
    library_heading_font: int = 18
    library_section_font: int = 13
    library_font: int = 13
    header_font: int = 13
    library_item_height: int = 22
    library_row_height: int = 24
    library_group_row_height: int = 23
    channel_font: int = 11
    time_badge_font: int = 13


@dataclass
class AppSettings:
    library_root: str
    recursive_import: bool = False
    default_theme: str = "dark"
    display_preset: str = "medium"
    export_notes_to_csv: bool = True
    main_window_width: int = 1500
    main_window_height: int = 920
    import_folder_dialog_width: int = 860
    import_folder_dialog_height: int = 180
    library_left_width: int = 390
    library_right_width: int = 1120
    analysis_channel_width: int = 330
    analysis_plot_width: int = 870
    analysis_detail_width: int = 350
    default_compare_offset_range_seconds: float = 10.0
    display_profile: DisplayProfile | None = None


DEFAULT_PROFILES: dict[str, DisplayProfile] = {
    "small": DisplayProfile(
        base_font=12,
        title_font=16,
        library_heading_font=18,
        library_section_font=13,
        library_font=13,
        header_font=13,
        library_item_height=22,
        library_row_height=24,
        library_group_row_height=23,
        channel_font=11,
        time_badge_font=13,
    ),
    "medium": DisplayProfile(
        base_font=13,
        title_font=17,
        library_heading_font=19,
        library_section_font=14,
        library_font=14,
        header_font=14,
        library_item_height=25,
        library_row_height=27,
        library_group_row_height=25,
        channel_font=12,
        time_badge_font=14,
    ),
    "large": DisplayProfile(
        base_font=15,
        title_font=20,
        library_heading_font=23,
        library_section_font=16,
        library_font=17,
        header_font=16,
        library_item_height=32,
        library_row_height=35,
        library_group_row_height=31,
        channel_font=14,
        time_badge_font=16,
    ),
}


def app_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parents[1]


def settings_path() -> Path:
    return app_dir() / "settings.json"


def setting_md_path() -> Path:
    return app_dir() / "setting.md"


def default_library_root() -> Path:
    return app_dir() / "library"


def load_settings() -> AppSettings:
    md_path = setting_md_path()
    if not md_path.exists():
        seed = _load_json_settings()
        save_settings(seed)
        return seed
    data = _parse_setting_md(md_path)
    root = _value(data, "file", "library_root", str(default_library_root()))
    recursive = _to_bool(_value(data, "file", "recursive_import", "false"))
    export_notes = _to_bool(_value(data, "file", "export_notes_to_csv", "true"))
    theme = _value(data, "system", "default_theme", "dark").lower()
    preset = _value(data, "system", "display_preset", "medium").lower()
    main_width = _to_int(_value(data, "layout", "main_window_width", "1500"), 1500)
    main_height = _to_int(_value(data, "layout", "main_window_height", "920"), 920)
    import_width = _to_int(_value(data, "layout", "import_folder_dialog_width", "860"), 860)
    import_height = _to_int(_value(data, "layout", "import_folder_dialog_height", "180"), 180)
    library_left = _to_int(_value(data, "layout", "library_left_width", "390"), 390)
    library_right = _to_int(_value(data, "layout", "library_right_width", "1120"), 1120)
    analysis_channel = _to_int(_value(data, "layout", "analysis_channel_width", "330"), 330)
    analysis_plot = _to_int(_value(data, "layout", "analysis_plot_width", "870"), 870)
    analysis_detail = _to_int(_value(data, "layout", "analysis_detail_width", "350"), 350)
    offset_range = _to_float(_value(data, "interaction", "default_compare_offset_range_seconds", "10.0"), 10.0)
    if preset not in DEFAULT_PROFILES:
        preset = "medium"
    profile = _profile_from_data(data, preset)
    return AppSettings(
        library_root=root,
        recursive_import=recursive,
        default_theme="light" if theme == "light" else "dark",
        display_preset=preset,
        export_notes_to_csv=export_notes,
        main_window_width=main_width,
        main_window_height=main_height,
        import_folder_dialog_width=import_width,
        import_folder_dialog_height=import_height,
        library_left_width=library_left,
        library_right_width=library_right,
        analysis_channel_width=analysis_channel,
        analysis_plot_width=analysis_plot,
        analysis_detail_width=analysis_detail,
        default_compare_offset_range_seconds=max(1.0, offset_range),
        display_profile=profile,
    )


def save_settings(settings: AppSettings) -> None:
    profile = settings.display_profile or DEFAULT_PROFILES.get(settings.display_preset, DEFAULT_PROFILES["medium"])
    md_path = setting_md_path()
    md_path.parent.mkdir(parents=True, exist_ok=True)
    md_path.write_text(_render_setting_md(settings, profile), encoding="utf-8")
    path = settings_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "library_root": settings.library_root,
                "recursive_import": settings.recursive_import,
                "default_theme": settings.default_theme,
                "display_preset": settings.display_preset,
                "export_notes_to_csv": settings.export_notes_to_csv,
                "main_window_width": settings.main_window_width,
                "main_window_height": settings.main_window_height,
                "import_folder_dialog_width": settings.import_folder_dialog_width,
                "import_folder_dialog_height": settings.import_folder_dialog_height,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )


def current_display_profile(settings: AppSettings) -> DisplayProfile:
    return settings.display_profile or DEFAULT_PROFILES.get(settings.display_preset, DEFAULT_PROFILES["medium"])


def _load_json_settings() -> AppSettings:
    path = settings_path()
    if not path.exists():
        return AppSettings(library_root=str(default_library_root()), display_profile=DEFAULT_PROFILES["medium"])
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return AppSettings(library_root=str(default_library_root()), display_profile=DEFAULT_PROFILES["medium"])
    preset = str(data.get("display_preset") or "medium").lower()
    if preset not in DEFAULT_PROFILES:
        preset = "medium"
    return AppSettings(
        library_root=str(data.get("library_root") or default_library_root()),
        recursive_import=bool(data.get("recursive_import", False)),
        default_theme="light" if str(data.get("default_theme")).lower() == "light" else "dark",
        display_preset=preset,
        export_notes_to_csv=bool(data.get("export_notes_to_csv", True)),
        main_window_width=int(data.get("main_window_width") or 1500),
        main_window_height=int(data.get("main_window_height") or 920),
        import_folder_dialog_width=int(data.get("import_folder_dialog_width") or 860),
        import_folder_dialog_height=int(data.get("import_folder_dialog_height") or 180),
        display_profile=DEFAULT_PROFILES[preset],
    )


def _parse_setting_md(path: Path) -> dict[str, dict[str, str]]:
    data: dict[str, dict[str, str]] = {}
    section = ""
    for raw_line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") and not line.startswith("##"):
            continue
        if line.startswith("[") and line.endswith("]"):
            section = line[1:-1].strip().lower()
            data.setdefault(section, {})
            continue
        if line.startswith("##"):
            section = _normalize_section(line.lstrip("#").strip())
            data.setdefault(section, {})
            continue
        if "=" not in line or not section:
            continue
        key, value = line.split("=", 1)
        data.setdefault(section, {})[key.strip()] = value.strip()
    return data


def _normalize_section(label: str) -> str:
    mapping = {
        "系统": "system",
        "文件": "file",
        "显示": "display",
        "显示预设": "display",
        "布局": "layout",
        "交互": "interaction",
        "预设-小": "preset.small",
        "预设-中": "preset.medium",
        "预设-大": "preset.large",
    }
    return mapping.get(label, label.strip().lower())


def _value(data: dict[str, dict[str, str]], section: str, key: str, default: str) -> str:
    return data.get(section, {}).get(key, default)


def _to_bool(value: str) -> bool:
    return str(value).strip().lower() in {"1", "true", "yes", "y", "on", "是", "启用"}


def _profile_from_data(data: dict[str, dict[str, str]], preset: str) -> DisplayProfile:
    base = DEFAULT_PROFILES[preset]
    values = data.get(f"preset.{preset}", {})
    return DisplayProfile(
        base_font=_to_int(values.get("base_font"), base.base_font),
        title_font=_to_int(values.get("title_font"), base.title_font),
        library_heading_font=_to_int(values.get("library_heading_font"), base.library_heading_font),
        library_section_font=_to_int(values.get("library_section_font"), base.library_section_font),
        library_font=_to_int(values.get("library_font"), base.library_font),
        header_font=_to_int(values.get("header_font"), base.header_font),
        library_item_height=_to_int(values.get("library_item_height"), base.library_item_height),
        library_row_height=_to_int(values.get("library_row_height"), base.library_row_height),
        library_group_row_height=_to_int(values.get("library_group_row_height"), base.library_group_row_height),
        channel_font=_to_int(values.get("channel_font"), base.channel_font),
        time_badge_font=_to_int(values.get("time_badge_font"), base.time_badge_font),
    )


def _to_int(value: str | None, default: int) -> int:
    try:
        return max(8, int(str(value)))
    except Exception:
        return default


def _to_float(value: str | None, default: float) -> float:
    try:
        return float(str(value))
    except Exception:
        return default


def _render_setting_md(settings: AppSettings, profile: DisplayProfile) -> str:
    profiles = dict(DEFAULT_PROFILES)
    profiles[settings.display_preset] = profile
    lines = [
        "# SCUT Racing Telemetry 设置",
        "",
        "## 系统",
        f"default_theme = {settings.default_theme}",
        f"display_preset = {settings.display_preset}",
        "",
        "## 文件",
        f"library_root = {settings.library_root}",
        f"recursive_import = {str(settings.recursive_import).lower()}",
        f"export_notes_to_csv = {str(settings.export_notes_to_csv).lower()}",
        "",
        "## 布局",
        "# 主窗口默认大小",
        f"main_window_width = {settings.main_window_width}",
        f"main_window_height = {settings.main_window_height}",
        "",
        "# 导入文件夹弹窗大小",
        f"import_folder_dialog_width = {settings.import_folder_dialog_width}",
        f"import_folder_dialog_height = {settings.import_folder_dialog_height}",
        "",
        "# 主页左右栏初始宽度",
        f"library_left_width = {settings.library_left_width}",
        f"library_right_width = {settings.library_right_width}",
        "",
        "# 分析页三栏初始宽度：左侧通道 / 中间图表 / 右侧统计",
        f"analysis_channel_width = {settings.analysis_channel_width}",
        f"analysis_plot_width = {settings.analysis_plot_width}",
        f"analysis_detail_width = {settings.analysis_detail_width}",
        "",
        "## 交互",
        "# B 文件手动时间偏移滑条范围，单位秒",
        f"default_compare_offset_range_seconds = {settings.default_compare_offset_range_seconds:g}",
        "",
        "## 显示",
        "下面三个预设可以直接改数字。软件界面选择的是 small / medium / large。",
        "",
    ]
    labels = {"small": "小", "medium": "中", "large": "大"}
    for key in ("small", "medium", "large"):
        item = profiles[key]
        lines.extend(
            [
                f"[preset.{key}]",
                f"# 预设-{labels[key]}",
                f"base_font = {item.base_font}",
                f"title_font = {item.title_font}",
                f"library_heading_font = {item.library_heading_font}",
                f"library_section_font = {item.library_section_font}",
                f"library_font = {item.library_font}",
                f"header_font = {item.header_font}",
                f"library_item_height = {item.library_item_height}",
                f"library_row_height = {item.library_row_height}",
                f"library_group_row_height = {item.library_group_row_height}",
                f"channel_font = {item.channel_font}",
                f"time_badge_font = {item.time_badge_font}",
                "",
            ]
        )
    return "\n".join(lines)
