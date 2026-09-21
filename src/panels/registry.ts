import type React from "react";
import { ChannelTree } from "./ChannelTree";
import { PlotStack } from "../components/PlotStack";
import { StatsPanel } from "./StatsPanel";
import { CommentsPanel } from "./CommentsPanel";
import { TrackMapPanel } from "./TrackMapPanel";

// D16：dockview 已移除，面板挂固定三栏容器；registry 仅保留"组件 + 归属栏"语义。
export type PanelProps = Record<string, never>;

export interface PanelDef {
  id: string; // 'channel-tree' | 'plot-stack' | 'stats' | 'comments' | 'track-map'
  title: string;
  component: React.FC<PanelProps>;
  defaultLocation: "left" | "right" | "center";
  minWidth?: number;
}

export const PANELS: PanelDef[] = [
  {
    id: "channel-tree",
    title: "通道 (Channels)",
    component: ChannelTree,
    defaultLocation: "left",
    minWidth: 220,
  },
  {
    id: "plot-stack",
    title: "绘图区 (Plot Stack)",
    component: PlotStack,
    defaultLocation: "center",
    minWidth: 400,
  },
  {
    id: "track-map",
    title: "赛道图 (Track Map)",
    component: TrackMapPanel,
    defaultLocation: "right",
    minWidth: 240,
  },
  {
    id: "stats",
    title: "统计 (Stats)",
    component: StatsPanel,
    defaultLocation: "right",
    minWidth: 240,
  },
  {
    id: "comments",
    title: "批注 (Comments)",
    component: CommentsPanel,
    defaultLocation: "right",
    minWidth: 240,
  },
];
