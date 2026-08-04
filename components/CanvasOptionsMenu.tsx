"use client";

import { useState, useRef, useEffect } from "react";

export type EdgeStyle = "straight" | "bent";

export type CanvasLayout = "tree" | "radial";

export interface NodeFilters {
  showAgents: boolean;
  showMCPServers: boolean;
  showLLM: boolean;
}

interface CanvasOptionsMenuProps {
  edgeStyle: EdgeStyle;
  onEdgeStyleChange: (style: EdgeStyle) => void;
  layout: CanvasLayout;
  onLayoutChange: (layout: CanvasLayout) => void;
  nodeFilters: NodeFilters;
  onNodeFiltersChange: (filters: NodeFilters) => void;
}

export default function CanvasOptionsMenu({
  edgeStyle,
  onEdgeStyleChange,
  layout,
  onLayoutChange,
  nodeFilters,
  onNodeFiltersChange,
}: CanvasOptionsMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        menuRef.current &&
        buttonRef.current &&
        !menuRef.current.contains(event.target as Node) &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        className={`flex h-8 w-8 items-center justify-center rounded-full border transition-colors shadow-md ${
          isOpen
            ? "border-primary bg-primary/10 text-primary"
            : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
        }`}
        aria-label="Canvas options"
        aria-expanded={isOpen}
      >
        <svg
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"
          />
        </svg>
      </button>
      {isOpen && (
        <div
          ref={menuRef}
          className="absolute right-0 bottom-full z-50 mb-2 w-56 rounded-lg border border-gray-200 bg-white shadow-lg"
        >
          <div className="border-b border-gray-200 px-3 py-2">
            <h3 className="text-sm font-semibold text-gray-900">Options</h3>
          </div>
          <div className="p-3 space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                Layout
              </label>
              <div className="space-y-1">
                <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-gray-50">
                  <input
                    type="radio"
                    name="layout"
                    value="tree"
                    checked={layout === "tree"}
                    onChange={() => {
                      onLayoutChange("tree");
                      setIsOpen(false);
                    }}
                    className="h-4 w-4 border-gray-300 text-primary focus:ring-primary"
                  />
                  <span className="text-sm text-gray-700">Tree</span>
                </label>
                <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-gray-50">
                  <input
                    type="radio"
                    name="layout"
                    value="radial"
                    checked={layout === "radial"}
                    onChange={() => {
                      onLayoutChange("radial");
                      setIsOpen(false);
                    }}
                    className="h-4 w-4 border-gray-300 text-primary focus:ring-primary"
                  />
                  <span className="text-sm text-gray-700">Radial</span>
                </label>
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                Edge style
              </label>
              <div className="space-y-1">
                <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-gray-50">
                  <input
                    type="radio"
                    name="edgeStyle"
                    value="straight"
                    checked={edgeStyle === "straight"}
                    onChange={() => {
                      onEdgeStyleChange("straight");
                      setIsOpen(false);
                    }}
                    className="h-4 w-4 border-gray-300 text-primary focus:ring-primary"
                  />
                  <span className="text-sm text-gray-700">Straight</span>
                </label>
                <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-gray-50">
                  <input
                    type="radio"
                    name="edgeStyle"
                    value="bent"
                    checked={edgeStyle === "bent"}
                    onChange={() => {
                      onEdgeStyleChange("bent");
                      setIsOpen(false);
                    }}
                    className="h-4 w-4 border-gray-300 text-primary focus:ring-primary"
                  />
                  <span className="text-sm text-gray-700">Bent</span>
                </label>
              </div>
            </div>
            <div className="border-t border-gray-200 pt-3">
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                Show nodes
              </label>
              <div className="space-y-1">
                <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={nodeFilters.showAgents}
                    onChange={(e) => {
                      onNodeFiltersChange({
                        ...nodeFilters,
                        showAgents: e.target.checked,
                      });
                    }}
                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                  />
                  <span className="text-sm text-gray-700">Show Agents</span>
                </label>
                <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={nodeFilters.showMCPServers}
                    onChange={(e) => {
                      onNodeFiltersChange({
                        ...nodeFilters,
                        showMCPServers: e.target.checked,
                      });
                    }}
                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                  />
                  <span className="text-sm text-gray-700">Show MCP Servers</span>
                </label>
                <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={nodeFilters.showLLM}
                    onChange={(e) => {
                      onNodeFiltersChange({
                        ...nodeFilters,
                        showLLM: e.target.checked,
                      });
                    }}
                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                  />
                  <span className="text-sm text-gray-700">Show LLM</span>
                </label>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
