import type React from "react";
import type { DockviewApi } from "dockview";
import { ChannelTree } from "./ChannelTree";
import { PlotStack } from "../components/PlotStack";
import { LapsPanel } from "./LapsPanel";
import { StatsPanel } from "./StatsPanel";
import { CommentsPanel } from "./CommentsPanel";
import { TrackMapPanel } from "./TrackMapPanel";

export interface PanelProps {
  api: DockviewApi;
}

export interface PanelDef {
  id: string; // 'channel-tree' | 'plot-stack' | 'laps' | 'stats' | 'comments' | 'track-map'
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
    id: "laps",
    title: "圈速 (Laps)",
    component: LapsPanel,
    defaultLocation: "right",
    minWidth: 200,
  },
  {
    id: "stats",
    title: "统计 (Stats)",
    component: StatsPanel,
    defaultLocation: "right",
    minWidth: 200,
  },
  {
    id: "comments",
    title: "批注 (Comments)",
    component: CommentsPanel,
    defaultLocation: "right",
    minWidth: 200,
  },
  {
    id: "track-map",
    title: "赛道图 (Track Map)",
    component: TrackMapPanel,
    defaultLocation: "right",
    minWidth: 200,
  },
];
