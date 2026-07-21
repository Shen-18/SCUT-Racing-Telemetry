from __future__ import annotations

import os
from pathlib import Path
from types import SimpleNamespace

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtCore import QCoreApplication, QEvent, Qt
from PySide6.QtWidgets import QApplication, QListWidget

from scut_telemetry.models import ChannelMeta
from scut_telemetry.ui.channel_list import ChannelList


def _app() -> QApplication:
    return QApplication.instance() or QApplication([])


def _dataset(keys: list[str]):
    channels = {
        key: ChannelMeta(key=key, name=key, unit="")
        for key in ["Time", *keys]
    }
    channels["Time"] = ChannelMeta(key="Time", name="Time", unit="s", dtype="time")
    return SimpleNamespace(
        meta=SimpleNamespace(
            file_path=Path("sample.csv"),
            session="",
            vehicle="",
            racer="",
            championship="",
            date="",
            start_time="",
            duration=0.0,
            sample_rate_hz=0.0,
            laps=[],
            comment="",
        ),
        channels=channels,
        header_order=["Time", *keys],
    )


def _order(list_widget: QListWidget, *, visible_only: bool = False) -> list[str]:
    values: list[str] = []
    for row in range(list_widget.count()):
        item = list_widget.item(row)
        if visible_only and item.isHidden():
            continue
        values.append(str(item.data(Qt.UserRole)))
    return values


def _set_checked(widget: ChannelList, key: str, checked: bool) -> None:
    widget.rows_by_key[key].set_checked(checked)
    _app().processEvents()


def test_checked_channels_are_split_from_available_channels_in_original_order() -> None:
    _app()
    widget = ChannelList()
    widget.set_datasets(_dataset(["A", "B", "C", "D"]), None)  # type: ignore[arg-type]

    for key in list(widget.selected_channels()):
        _set_checked(widget, key, False)

    _set_checked(widget, "C", True)
    assert _order(widget.selected_list_widget) == ["C"]
    assert _order(widget.available_list_widget) == ["A", "B", "D"]

    _set_checked(widget, "B", True)
    assert _order(widget.selected_list_widget) == ["B", "C"]
    assert _order(widget.available_list_widget) == ["A", "D"]

    _set_checked(widget, "C", False)
    assert _order(widget.selected_list_widget) == ["B"]
    assert _order(widget.available_list_widget) == ["A", "C", "D"]


def test_reordering_does_not_delete_row_widgets_between_loads() -> None:
    app = _app()
    widget = ChannelList()
    widget.set_datasets(_dataset(["A", "B", "C", "D"]), None)  # type: ignore[arg-type]

    for key in list(widget.selected_channels()):
        _set_checked(widget, key, False)

    _set_checked(widget, "C", True)
    app.processEvents()

    assert widget.selected_channels() == ["C"]
    widget.set_datasets(_dataset(["A", "B", "C", "D"]), None)  # type: ignore[arg-type]
    app.processEvents()
    assert widget.selected_channels() == ["C"]


def test_selected_channels_survive_qt_deferred_delete_after_reordering() -> None:
    app = _app()
    widget = ChannelList()
    widget.set_datasets(_dataset(["L MOTOR SPEED", "X", "R MOTOR SPEED", "Y", "Battery Current", "GPS Speed"]), None)  # type: ignore[arg-type]
    app.processEvents()
    QCoreApplication.sendPostedEvents(None, QEvent.DeferredDelete)
    app.processEvents()

    assert widget.selected_channels() == ["L MOTOR SPEED", "R MOTOR SPEED", "Battery Current"]


def test_search_filters_only_available_channels_and_keeps_selected_visible() -> None:
    _app()
    widget = ChannelList()
    widget.set_datasets(_dataset(["Speed", "Brake", "Throttle", "Battery Current"]), None)  # type: ignore[arg-type]

    for key in list(widget.selected_channels()):
        _set_checked(widget, key, False)
    _set_checked(widget, "Brake", True)

    widget.search.setText("current")

    assert _order(widget.selected_list_widget, visible_only=True) == ["Brake"]
    assert _order(widget.available_list_widget, visible_only=True) == ["Battery Current"]
    assert widget.search.isClearButtonEnabled()

    widget.search.clear()
    assert _order(widget.selected_list_widget, visible_only=True) == ["Brake"]
    assert _order(widget.available_list_widget, visible_only=True) == ["Speed", "Throttle", "Battery Current"]


def test_channel_sections_use_plain_divider_without_heading_labels() -> None:
    _app()
    widget = ChannelList()

    assert not hasattr(widget, "selected_label")
    assert not hasattr(widget, "available_label")
    assert not hasattr(widget, "channel_splitter")
    assert widget.selected_list_widget.minimumHeight() == 0
    assert widget.available_list_widget.minimumHeight() == 0
    assert widget.channel_separator.objectName() == "ChannelSeparator"
    assert widget.channel_separator.frameShape() == widget.channel_separator.Shape.HLine


def test_search_sits_below_file_info_and_above_selected_channels() -> None:
    _app()
    widget = ChannelList()
    layout = widget.layout()

    assert layout.indexOf(widget.file_label) < layout.indexOf(widget.search)
    assert layout.indexOf(widget.meta_toggle) < layout.indexOf(widget.search)
    assert layout.indexOf(widget.meta_panel) < layout.indexOf(widget.search)
    assert layout.indexOf(widget.search) < layout.indexOf(widget.channel_section)
