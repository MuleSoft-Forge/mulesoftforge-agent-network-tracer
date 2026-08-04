import { useCallback, useEffect, useState, type RefObject } from "react";

/**
 * Vertical splitter drag — canvas pane vs. task-details pane. Percent is
 * clamped to [0, 95].
 */
export function useCanvasResize(
  contentAreaRef: RefObject<HTMLDivElement | null>,
  initialPercent: number
) {
  const [canvasHeightPercent, setCanvasHeightPercent] = useState(initialPercent);
  const [isResizing, setIsResizing] = useState(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const el = contentAreaRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const next = Math.max(0, Math.min(95, (y / rect.height) * 100));
      setCanvasHeightPercent(next);
    };

    const handleMouseUp = () => setIsResizing(false);

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, contentAreaRef]);

  return { canvasHeightPercent, setCanvasHeightPercent, handleMouseDown };
}
