# SCUT Racing Telemetry 设置

## 系统
default_theme = dark
display_preset = medium

## 文件
library_root = ./library
recursive_import = false
export_notes_to_csv = true

## 布局
# 主窗口默认大小
main_window_width = 1500
main_window_height = 920

# 导入文件夹弹窗大小
import_folder_dialog_width = 860
import_folder_dialog_height = 180

# 主页左右栏初始宽度
library_left_width = 390
library_right_width = 1120

# 分析页三栏初始宽度：左侧通道 / 中间图表 / 右侧统计
analysis_channel_width = 330
analysis_plot_width = 870
analysis_detail_width = 350

## 交互
# B 文件手动时间偏移滑条范围，单位秒
default_compare_offset_range_seconds = 10

## 显示
下面三个预设可以直接改数字。软件界面选择的是 small / medium / large。

[preset.small]
# 预设-小
base_font = 12
title_font = 16
library_heading_font = 18
library_section_font = 13
library_font = 13
header_font = 13
library_item_height = 22
library_row_height = 24
library_group_row_height = 23
channel_font = 11
time_badge_font = 13

[preset.medium]
# 预设-中
base_font = 13
title_font = 17
library_heading_font = 19
library_section_font = 14
library_font = 14
header_font = 14
library_item_height = 25
library_row_height = 27
library_group_row_height = 25
channel_font = 12
time_badge_font = 14

[preset.large]
# 预设-大
base_font = 15
title_font = 20
library_heading_font = 23
library_section_font = 16
library_font = 17
header_font = 16
library_item_height = 32
library_row_height = 35
library_group_row_height = 31
channel_font = 14
time_badge_font = 16
