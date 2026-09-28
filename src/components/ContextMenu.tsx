import React, { useEffect, useLayoutEffect, useRef, useState } from "react";

// 自绘右键菜单（方案 A，2026-09-28 负责人指定）：
// F1 风格深色面板，红色 hover；点击/Esc/滚动/失焦/窗口缩放关闭；
// 位置 clamp 在视口内。默认 WebView2 菜单在 AppShell 全局拦截。

export interface ContextMenuItem {
  key: string;
  label: string;
  onSelect(): void;
  /** 危险操作（删除类）：红色文字提示。 */
  danger?: boolean;
  disabled?: boolean;
}

export interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

/** 菜单出现位置 clamp 到视口内（含 8px 安全边距）。 */
export function clampMenuPosition(
  x: number,
  y: number,
  width: number,
  height: number
): { x: number; y: number } {
  const margin = 8;
  const maxX = Math.max(margin, window.innerWidth - width - margin);
  const maxY = Math.max(margin, window.innerHeight - height - margin);
  return {
    x: Math.min(Math.max(x, margin), maxX),
    y: Math.min(Math.max(y, margin), maxY),
  };
}

export const ContextMenu: React.FC<{ menu: ContextMenuState | null; onClose(): void }> = ({
  menu,
  onClose,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  useLayoutEffect(() => {
    if (!menu) return;
    const rect = panelRef.current?.getBoundingClientRect();
    const width = rect?.width ?? 180;
    const height = rect?.height ?? Math.max(40, menu.items.length * 34);
    setPos(clampMenuPosition(menu.x, menu.y, width, height));
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (panelRef.current && target && panelRef.current.contains(target)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    globalThis.addEventListener("mousedown", onPointerDown, true);
    globalThis.addEventListener("keydown", onKeyDown);
    globalThis.addEventListener("resize", onClose);
    globalThis.addEventListener("scroll", onClose, true);
    return () => {
      globalThis.removeEventListener("mousedown", onPointerDown, true);
      globalThis.removeEventListener("keydown", onKeyDown);
      globalThis.removeEventListener("resize", onClose);
      globalThis.removeEventListener("scroll", onClose, true);
    };
  }, [menu, onClose]);

  if (!menu) return null;

  return (
    <div
      ref={panelRef}
      data-testid="context-menu"
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: "fixed",
        left: `${pos.x}px`,
        top: `${pos.y}px`,
        zIndex: 1000,
        minWidth: "168px",
        background: "var(--bg2, #1B1B27)",
        border: "1px solid var(--line)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.55)",
        padding: "4px 0",
        userSelect: "none",
      }}
    >
      {menu.items.map((item) => (
        <div
          key={item.key}
          className="context-menu__item"
          onClick={() => {
            if (item.disabled) return;
            onClose();
            item.onSelect();
          }}
          title={item.label}
          style={{
            padding: "8px 14px",
            fontSize: "12px",
            fontWeight: 600,
            letterSpacing: "0.5px",
            color: item.disabled ? "var(--dim2)" : item.danger ? "var(--red)" : "var(--text)",
            cursor: item.disabled ? "default" : "pointer",
            whiteSpace: "nowrap",
          }}
          onMouseEnter={(e) => {
            if (item.disabled) return;
            e.currentTarget.style.background = "var(--red)";
            e.currentTarget.style.color = "#fff";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = item.disabled
              ? "var(--dim2)"
              : item.danger
                ? "var(--red)"
                : "var(--text)";
          }}
        >
          {item.label}
        </div>
      ))}
    </div>
  );
};
