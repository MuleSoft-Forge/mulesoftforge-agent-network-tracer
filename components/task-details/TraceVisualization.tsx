"use client";

import { useMemo, useState, useEffect } from "react";
import type React from "react";
import { ChevronDown, ChevronUp, ChevronsDown, ChevronsUp } from "lucide-react";
import type { TraceSpan, LogEntry } from "./types";
import { debugWarn, debugError } from "@/lib/api-logger";

interface TraceVisualizationProps {
  traceSpans: TraceSpan[];
  logEntries: LogEntry[];
  onSpanClick?: (span: TraceSpan) => void;
  onLogEntryClick?: (entry: LogEntry) => void;
}

type SpanFilter = {
  kind?: string;
  statusCode?: string;
  entityType?: string;
};

export default function TraceVisualization({
  traceSpans,
  logEntries,
  onSpanClick,
  onLogEntryClick,
}: TraceVisualizationProps) {
  const [viewMode, setViewMode] = useState<"timeline" | "hierarchy">("timeline");
  const [filters, setFilters] = useState<SpanFilter>({});
  const [expandedSpans, setExpandedSpans] = useState<Set<string>>(new Set());

  // Reset expanded spans when traceSpans change significantly or when switching to hierarchy view
  useEffect(() => {
    if (viewMode === "hierarchy") {
      // Only reset if we're switching to hierarchy view
      setExpandedSpans(new Set());
    }
  }, [viewMode]);

  // Reset expanded spans when traceSpans change (new trace loaded)
  useEffect(() => {
    setExpandedSpans(new Set());
  }, [traceSpans.length]);

  // Calculate start times and build hierarchy
  const processedSpans = useMemo(() => {
    const spans = traceSpans.map((span: TraceSpan) => ({
      ...span,
      startTime: span.startTime ?? (span.endTime - span.duration),
    }));

    // Sort by start time
    spans.sort((a: TraceSpan, b: TraceSpan) => (a.startTime ?? 0) - (b.startTime ?? 0));

    // Link log entries to spans by spanId
    // Trace span IDs are 16 hex chars, log spanIds might be full traceparent format
    const spansWithLogs = spans.map((span: TraceSpan) => {
      const matchingLogs = logEntries.filter((entry: LogEntry) => {
        const logSpanId = entry.fields.spanId;
        if (!logSpanId) return false;
        const logSpanIdStr = String(logSpanId).toLowerCase();
        const spanIdStr = span.spanId.toLowerCase();
        // Match if log spanId contains the trace spanId (traceparent format includes spanId)
        // or if they match exactly
        return logSpanIdStr.includes(spanIdStr) || spanIdStr.includes(logSpanIdStr.slice(0, 16));
      });
      return { ...span, logEntries: matchingLogs };
    });

    // Build hierarchy (infer parent-child relationships)
    const spanMap = new Map<string, TraceSpan>();
    spansWithLogs.forEach((span: TraceSpan) => {
      spanMap.set(span.spanId, { ...span, children: [] });
    });

    const rootSpans: TraceSpan[] = [];
    const processed = new Set<string>(); // Track processed spans to prevent duplicates
    
    spansWithLogs.forEach((span: TraceSpan) => {
      if (processed.has(span.spanId)) return; // Skip if already processed as a child
      
      const spanWithChildren = spanMap.get(span.spanId);
      if (!spanWithChildren) return;

      // Try to find parent: spans that start before and end after this span
      // Exclude spans that are the same or have overlapping time ranges that could cause cycles
      let parent: TraceSpan | undefined;
      for (const [id, candidate] of spanMap.entries()) {
        if (id === span.spanId) continue;
        const candidateStart = candidate.startTime ?? 0;
        const candidateEnd = candidate.endTime;
        const spanStart = span.startTime ?? 0;
        const spanEnd = span.endTime;

        // Only consider as parent if it fully contains this span (not just overlaps)
        // This prevents circular references
        if (candidateStart < spanStart && candidateEnd > spanEnd) {
          if (!parent || (candidateStart > (parent.startTime ?? 0) && candidateEnd < parent.endTime)) {
            parent = candidate;
          }
        }
      }

      if (parent) {
        const parentWithChildren = spanMap.get(parent.spanId);
        if (parentWithChildren && parent.spanId !== span.spanId) { // Extra safety check
          parentWithChildren.children = parentWithChildren.children || [];
          // Check for duplicate children
          const alreadyChild = parentWithChildren.children.some((child: TraceSpan) => child.spanId === span.spanId);
          if (!alreadyChild) {
            parentWithChildren.children.push(spanWithChildren);
            spanWithChildren.parentSpanId = parent.spanId;
            processed.add(span.spanId);
          }
        } else {
          // Parent check failed, add as root
          rootSpans.push(spanWithChildren);
        }
      } else {
        rootSpans.push(spanWithChildren);
      }
    });

    return { flat: spansWithLogs, hierarchy: rootSpans };
  }, [traceSpans, logEntries]);

  // Apply filters
  const filteredSpans = useMemo(() => {
    let filtered = processedSpans.flat;
    if (filters.kind) {
      filtered = filtered.filter((span: TraceSpan) => span.kind === filters.kind);
    }
    if (filters.statusCode) {
      filtered = filtered.filter((span: TraceSpan) => span.statusCode === filters.statusCode);
    }
    if (filters.entityType) {
      filtered = filtered.filter((span: TraceSpan) => span.entityType === filters.entityType);
    }
    return filtered;
  }, [processedSpans, filters]);

  // Build filtered hierarchy (only show filtered spans and their ancestors/descendants)
  const filteredHierarchy = useMemo(() => {
    if (!filters.kind && !filters.statusCode && !filters.entityType) {
      // No filters - use original hierarchy
      return processedSpans.hierarchy;
    }

    // Rebuild hierarchy from filtered spans
    const filteredSpanIds = new Set(filteredSpans.map((span: TraceSpan) => span.spanId));
    
    // Helper to recursively filter hierarchy
    const filterHierarchy = (spans: TraceSpan[]): TraceSpan[] => {
      return spans
        .map((span: TraceSpan) => {
          const filteredChildren = span.children ? filterHierarchy(span.children) : [];
          const isIncluded = filteredSpanIds.has(span.spanId) || filteredChildren.length > 0;
          
          if (isIncluded) {
            return { ...span, children: filteredChildren };
          }
          return null;
        })
        .filter((span: TraceSpan | null): span is TraceSpan => span !== null) as TraceSpan[];
    };

    return filterHierarchy(processedSpans.hierarchy);
  }, [processedSpans.hierarchy, filteredSpans, filters]);

  // Collect all span IDs that have children (for expand/collapse all)
  const spansWithChildren = useMemo(() => {
    const ids = new Set<string>();
    const collectIds = (spans: TraceSpan[]): void => {
      spans.forEach((span: TraceSpan) => {
        if (span.children && span.children.length > 0) {
          ids.add(span.spanId);
          collectIds(span.children);
        }
      });
    };
    collectIds(filteredHierarchy);
    return ids;
  }, [filteredHierarchy]);

  // Check if all spans with children are expanded
  const allExpanded = useMemo(() => {
    if (spansWithChildren.size === 0) return true;
    return Array.from(spansWithChildren).every((id: string) => expandedSpans.has(id));
  }, [spansWithChildren, expandedSpans]);

  // Toggle expand/collapse all
  const toggleExpandAll = (): void => {
    if (allExpanded) {
      // Collapse all
      setExpandedSpans(new Set());
    } else {
      // Expand all
      setExpandedSpans(new Set(spansWithChildren));
    }
  };

  // Calculate timeline bounds
  const timelineBounds = useMemo(() => {
    if (filteredSpans.length === 0) return { min: 0, max: 0, total: 0 };
    const times = filteredSpans.map((span: TraceSpan) => [
      span.startTime ?? 0,
      span.endTime,
    ]).flat();
    const min = Math.min(...times);
    const max = Math.max(...times);
    return { min, max, total: max - min };
  }, [filteredSpans]);

  // Get unique filter values
  const uniqueKinds = useMemo(() => Array.from(new Set(traceSpans.map((s: TraceSpan) => s.kind))), [traceSpans]);
  const uniqueStatusCodes = useMemo(() => Array.from(new Set(traceSpans.map((s: TraceSpan) => s.statusCode))), [traceSpans]);
  const uniqueEntityTypes = useMemo(() => Array.from(new Set(traceSpans.map((s: TraceSpan) => s.entityType).filter((t: string | undefined): t is string => Boolean(t)))), [traceSpans]);

  const getSpanColor = (span: TraceSpan): string => {
    if (span.statusCode === "STATUS_CODE_ERROR" || (span.httpStatusCode && parseInt(span.httpStatusCode) >= 400)) {
      return "bg-red-500";
    }
    if (span.entityType === "APP") return "bg-blue-500";
    if (span.entityType === "API") return "bg-green-500";
    if (span.name.includes("[LLM]")) return "bg-purple-500";
    if (span.name.includes("[Agent]")) return "bg-yellow-500";
    if (span.name.includes("[BROKER]")) return "bg-indigo-500";
    return "bg-gray-500";
  };

  const formatDuration = (nanoseconds: number): string => {
    const ms = nanoseconds / 1000000;
    if (ms < 1) return `${(nanoseconds / 1000).toFixed(2)}μs`;
    if (ms < 1000) return `${ms.toFixed(2)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const getSpanPosition = (span: TraceSpan): { left: number; width: number } => {
    if (timelineBounds.total === 0) return { left: 0, width: 0 };
    const left = ((span.startTime ?? 0) - timelineBounds.min) / timelineBounds.total * 100;
    const width = (span.duration / timelineBounds.total) * 100;
    return { left: Math.max(0, left), width: Math.max(0.1, width) };
  };

  const renderTimelineView = () => {
    if (filteredSpans.length === 0) {
      return <div className="p-4 text-sm text-gray-500">No spans match the current filters</div>;
    }

    return (
      <div className="space-y-1">
        {filteredSpans.map((span: TraceSpan, idx: number) => {
          const { left, width } = getSpanPosition(span);
          const isError = span.statusCode === "STATUS_CODE_ERROR" || (span.httpStatusCode && parseInt(span.httpStatusCode) >= 400);
          const hasLogs = span.logEntries && span.logEntries.length > 0;

          return (
            <div
              key={`${span.traceId}-${span.spanId}-${idx}`}
              className="group relative flex items-center gap-2 py-1 hover:bg-gray-50 rounded cursor-pointer"
              onClick={() => onSpanClick?.(span)}
              title="Click to view related log entries"
            >
              <div className="w-32 shrink-0 text-xs text-gray-600 truncate" title={span.name}>
                {span.name.length > 20 ? `${span.name.slice(0, 20)}...` : span.name}
              </div>
              <div className="flex-1 relative h-6 bg-gray-100 rounded overflow-hidden">
                <div
                  className={`absolute top-0 h-full ${getSpanColor(span)} ${isError ? "opacity-90" : "opacity-70"} rounded cursor-pointer transition-opacity group-hover:opacity-100`}
                  style={{ left: `${left}%`, width: `${width}%` }}
                  title={`${span.name} (${formatDuration(span.duration)})`}
                />
                {hasLogs && (
                  <div className="absolute right-1 top-1/2 -translate-y-1/2 w-2 h-2 bg-blue-600 rounded-full" title={`${span.logEntries?.length} log entries`} />
                )}
              </div>
              <div className="w-20 shrink-0 text-xs text-gray-500 text-right">
                {formatDuration(span.duration)}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderHierarchyView = (spans: TraceSpan[], depth = 0, visited = new Set<string>()): React.ReactNode => {
    // Safety: prevent infinite recursion and excessive depth
    if (depth > 20) {
      debugWarn("[TraceVisualization] Maximum depth reached in hierarchy view");
      return <div className="pl-4 text-xs text-red-500">Maximum depth reached (20 levels)</div>;
    }

    if (!spans || spans.length === 0) {
      return null;
    }

    return (
      <div className="space-y-1">
        {spans.map((span: TraceSpan) => {
          // Safety: prevent circular references
          if (visited.has(span.spanId)) {
            debugWarn(`[TraceVisualization] Circular reference detected for span ${span.spanId} at depth ${depth}`);
            return (
              <div key={`${span.spanId}-circular`} className="pl-4 text-xs text-orange-600">
                ⚠️ Circular reference: {span.name}
              </div>
            );
          }

          const isExpanded = expandedSpans.has(span.spanId);
          const hasChildren = span.children && span.children.length > 0 && span.children.length > 0;
          const isError = span.statusCode === "STATUS_CODE_ERROR" || (span.httpStatusCode && parseInt(span.httpStatusCode) >= 400);
          const hasLogs = span.logEntries && span.logEntries.length > 0;

          const newVisited = new Set(visited);
          newVisited.add(span.spanId);

          return (
            <div key={`${span.spanId}-${depth}`} className="pl-4">
              <div
                className={`flex items-center gap-2 py-1 px-2 rounded cursor-pointer hover:bg-gray-50 ${isError ? "bg-red-50" : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  // Only toggle expansion, don't trigger span click navigation
                  // Span click navigation should be separate from expansion
                  if (hasChildren) {
                    setExpandedSpans((prev) => {
                      const next = new Set(prev);
                      if (isExpanded) {
                        next.delete(span.spanId);
                      } else {
                        next.add(span.spanId);
                      }
                      return next;
                    });
                  }
                }}
              >
                {hasChildren && (
                  <span className="w-4 text-gray-400 select-none">
                    {isExpanded ? "▼" : "▶"}
                  </span>
                )}
                {!hasChildren && <span className="w-4" />}
                <div className={`w-3 h-3 rounded ${getSpanColor(span)}`} />
                <div className="flex-1 text-xs truncate">
                  <span className="font-medium">{span.name}</span>
                  {span.entityName && (
                    <span className="ml-2 text-gray-500">
                      ({span.entityType}: {span.entityName})
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-500 shrink-0">
                  {formatDuration(span.duration)}
                </div>
                {hasLogs && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (span.logEntries && span.logEntries.length > 0) {
                        onLogEntryClick?.(span.logEntries[0]);
                      }
                    }}
                    className="text-xs text-blue-600 hover:text-blue-800 shrink-0 px-2 py-0.5 rounded hover:bg-blue-50"
                    title={`View ${span.logEntries?.length} log entries`}
                  >
                    {span.logEntries?.length} log{span.logEntries && span.logEntries.length !== 1 ? "s" : ""}
                  </button>
                )}
              </div>
              {hasChildren && isExpanded && (
                <div className="ml-4 border-l-2 border-gray-200">
                  {renderHierarchyView(span.children || [], depth + 1, newVisited)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center justify-between gap-4 border-b border-gray-200 pb-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setViewMode("timeline")}
            className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
              viewMode === "timeline"
                ? "bg-indigo-100 text-indigo-700"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            Timeline
          </button>
          <button
            type="button"
            onClick={() => setViewMode("hierarchy")}
            className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
              viewMode === "hierarchy"
                ? "bg-indigo-100 text-indigo-700"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            Hierarchy
          </button>
          {viewMode === "hierarchy" && spansWithChildren.size > 0 && (
            <button
              type="button"
              onClick={toggleExpandAll}
              className="flex items-center gap-1 px-3 py-1 text-xs font-medium rounded bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
              title={allExpanded ? "Collapse all spans" : "Expand all spans"}
            >
              {allExpanded ? (
                <>
                  <ChevronsUp className="h-3 w-3" />
                  Collapse All
                </>
              ) : (
                <>
                  <ChevronsDown className="h-3 w-3" />
                  Expand All
                </>
              )}
            </button>
          )}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2">
          <select
            value={filters.kind || ""}
            onChange={(e) => setFilters({ ...filters, kind: e.target.value || undefined })}
            className="text-xs border border-gray-300 rounded px-2 py-1"
          >
            <option value="">All Kinds</option>
            {uniqueKinds.map((kind: string) => (
              <option key={kind} value={kind}>
                {kind.replace("SPAN_KIND_", "")}
              </option>
            ))}
          </select>
          <select
            value={filters.statusCode || ""}
            onChange={(e) => setFilters({ ...filters, statusCode: e.target.value || undefined })}
            className="text-xs border border-gray-300 rounded px-2 py-1"
          >
            <option value="">All Status</option>
            {uniqueStatusCodes.map((status: string) => (
              <option key={status} value={status}>
                {status.replace("STATUS_CODE_", "")}
              </option>
            ))}
          </select>
          {uniqueEntityTypes.length > 0 && (
            <select
              value={filters.entityType || ""}
              onChange={(e) => setFilters({ ...filters, entityType: e.target.value || undefined })}
              className="text-xs border border-gray-300 rounded px-2 py-1"
            >
              <option value="">All Entities</option>
              {uniqueEntityTypes.map((type: string) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          )}
          {(filters.kind || filters.statusCode || filters.entityType) && (
            <button
              type="button"
              onClick={() => setFilters({})}
              className="text-xs text-gray-600 hover:text-gray-800"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Visualization */}
      <div className="overflow-auto max-h-[600px]">
        {viewMode === "timeline" ? (
          renderTimelineView()
        ) : (
          (() => {
            try {
              if (filteredHierarchy.length === 0) {
                return <div className="p-4 text-sm text-gray-500">No spans match the current filters</div>;
              }
              return renderHierarchyView(filteredHierarchy);
            } catch (error) {
              debugError("[TraceVisualization] Error rendering hierarchy:", error);
              return (
                <div className="p-4 text-sm text-red-600">
                  Error rendering hierarchy view. Please try switching to timeline view or clearing filters.
                  <details className="mt-2 text-xs">
                    <summary>Error details</summary>
                    <pre className="mt-1 text-xs">{error instanceof Error ? error.message : String(error)}</pre>
                  </details>
                </div>
              );
            }
          })()
        )}
      </div>

      {/* Legend */}
      <div className="border-t border-gray-200 pt-3">
        <div className="text-xs font-semibold text-gray-600 mb-2">Legend:</div>
        <div className="flex flex-wrap gap-4 text-xs text-gray-600">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-blue-500" />
            <span>App</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-green-500" />
            <span>API</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-purple-500" />
            <span>LLM</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-yellow-500" />
            <span>Agent</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-indigo-500" />
            <span>Broker</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-red-500" />
            <span>Error</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-blue-600" />
            <span>Has logs</span>
          </div>
        </div>
      </div>
    </div>
  );
}
