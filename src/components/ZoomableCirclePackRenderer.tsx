import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import * as d3 from 'd3';
import { regionColor } from '../utils/color.js';
import { scoreToColor } from '../utils/colorScale.js';
import type { ColorScale } from '../utils/colorScale.js';
import type { LayerScore } from '../layers/types.js';

/**
 * Hierarchical node for zoomable circle packing.
 * Built by pre-fetching multiple zoom levels into a nested tree.
 */
export interface HierarchyNode {
  id: string;
  name: string;
  moduleCount: number;
  loc: number;
  children?: HierarchyNode[];
  /** true if this node can be zoomed deeper but children haven't been fetched yet */
  childrenPending?: boolean;
}

interface ZoomableCirclePackRendererProps {
  root: HierarchyNode | null;
  loading: boolean;
  width?: number;
  height?: number;
  regionSizeBy?: 'modules' | 'loc';
  onRegionSelect?: (regionId: string) => void;
  onRequestChildren?: (regionId: string) => void;
  regionScores?: Map<string, LayerScore>;
  colorScale?: ColorScale;
  selectedRegionId?: string | null;
  /** Called when zoom focus changes — provides breadcrumb path */
  onFocusChange?: (path: { id: string; name: string }[]) => void;
}

type PackedNode = d3.HierarchyCircularNode<HierarchyNode>;

const TRANSITION_MS = 750;

export function ZoomableCirclePackRenderer({
  root,
  loading,
  width = 960,
  height = 540,
  regionSizeBy = 'modules',
  onRegionSelect,
  onRequestChildren,
  regionScores,
  colorScale,
  selectedRegionId,
  onFocusChange,
}: ZoomableCirclePackRendererProps) {
  const [focusNode, setFocusNode] = useState<PackedNode | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [viewTransform, setViewTransform] = useState({ x: width / 2, y: height / 2, k: 1 });
  const [isTransitioning, setIsTransitioning] = useState(false);
  const transitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const diameter = Math.min(width, height);

  // Build the d3 hierarchy and pack layout
  const packed = useMemo((): PackedNode | null => {
    if (!root) return null;

    const hierarchy = d3
      .hierarchy(root)
      .sum((d) => {
        // Leaf nodes get their value; branch nodes sum children
        if (!d.children || d.children.length === 0) {
          return Math.max(1, regionSizeBy === 'loc' ? d.loc : d.moduleCount);
        }
        return 0;
      })
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

    const packLayout = d3
      .pack<HierarchyNode>()
      .size([diameter, diameter])
      .padding(3);

    return packLayout(hierarchy);
  }, [root, diameter, regionSizeBy]);

  // Initialize focus to root when packed changes
  useEffect(() => {
    if (packed) {
      setFocusNode(packed);
      setViewTransform({ x: width / 2, y: height / 2, k: 1 });
    }
  }, [packed, width, height]);

  // Compute the zoom transform for a given focus node
  const zoomTo = useCallback(
    (node: PackedNode) => {
      // k = how much to scale so the node fills the view
      const k = diameter / (node.r * 2);
      // translate so node center is at viewport center
      const x = width / 2 - node.x * k;
      const y = height / 2 - node.y * k;
      return { x, y, k };
    },
    [diameter, width, height],
  );

  // Build breadcrumb path for a node
  const buildPath = useCallback((node: PackedNode): { id: string; name: string }[] => {
    const path: { id: string; name: string }[] = [];
    let current: PackedNode | null = node;
    while (current) {
      path.unshift({ id: current.data.id, name: current.data.name });
      current = current.parent ?? null;
    }
    return path;
  }, []);

  // Handle click on a circle — zoom into it
  const handleCircleClick = useCallback(
    (node: PackedNode, e: React.MouseEvent) => {
      e.stopPropagation();

      // If clicking the currently focused node, select it
      if (focusNode === node) {
        onRegionSelect?.(node.data.id);
        return;
      }

      // If node is a parent of the current focus (clicking background circle), zoom out to it
      // If node is a child of focus, zoom into it
      setFocusNode(node);
      const newTransform = zoomTo(node);

      // Start transition
      setIsTransitioning(true);
      setViewTransform(newTransform);

      if (transitionTimerRef.current) {
        clearTimeout(transitionTimerRef.current);
      }
      transitionTimerRef.current = setTimeout(() => {
        setIsTransitioning(false);
      }, TRANSITION_MS);

      onFocusChange?.(buildPath(node));

      // Request children if they haven't been loaded
      if (node.data.childrenPending) {
        onRequestChildren?.(node.data.id);
      }
    },
    [focusNode, zoomTo, onFocusChange, onRequestChildren, onRegionSelect, buildPath],
  );

  // Click background to zoom out to parent
  const handleBackgroundClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target !== e.currentTarget) return;
      if (!focusNode?.parent) return;

      const parent = focusNode.parent;
      setFocusNode(parent);
      const newTransform = zoomTo(parent);

      setIsTransitioning(true);
      setViewTransform(newTransform);

      if (transitionTimerRef.current) {
        clearTimeout(transitionTimerRef.current);
      }
      transitionTimerRef.current = setTimeout(() => {
        setIsTransitioning(false);
      }, TRANSITION_MS);

      onFocusChange?.(buildPath(parent));
    },
    [focusNode, zoomTo, onFocusChange, buildPath],
  );

  // Cleanup timer
  useEffect(() => {
    return () => {
      if (transitionTimerRef.current) {
        clearTimeout(transitionTimerRef.current);
      }
    };
  }, []);

  // Determine which nodes are visible and how to render them
  // Culls circles that are too small to see or entirely outside the viewport
  const visibleNodes = useMemo((): PackedNode[] => {
    if (!packed) return [];

    const k = viewTransform.k;
    const tx = viewTransform.x;
    const ty = viewTransform.y;
    const minScreenRadius = 1.5; // pixels — below this, circle is invisible
    const padding = 50; // extra pixels of margin outside viewport

    return packed.descendants().filter((node) => {
      const screenR = node.r * k;

      // Too small to see
      if (screenR < minScreenRadius) return false;

      // Off-screen check: transform node center to screen coords
      const screenX = node.x * k + tx;
      const screenY = node.y * k + ty;

      if (
        screenX + screenR < -padding ||
        screenX - screenR > width + padding ||
        screenY + screenR < -padding ||
        screenY - screenR > height + padding
      ) {
        return false;
      }

      return true;
    });
  }, [packed, viewTransform, width, height]);

  // Determine label visibility based on focus
  const isLabelVisible = useCallback(
    (node: PackedNode): boolean => {
      if (!focusNode) return false;
      // Show labels for direct children of the focus node
      if (node.parent === focusNode) return true;
      // Show label for the focus node itself if it's not root
      if (node === focusNode && node.depth > 0) return true;
      return false;
    },
    [focusNode],
  );

  // Determine circle opacity based on depth relative to focus
  const getCircleOpacity = useCallback(
    (node: PackedNode): number => {
      if (!focusNode) return 1;
      const focusDepth = focusNode.depth;
      const nodeDepth = node.depth;

      // Root circle is always visible but subtle
      if (nodeDepth === 0) return 0.15;
      // Focus node and its children: fully visible
      if (node === focusNode) return 0.3;
      if (node.parent === focusNode) return 1;
      // Grandchildren: slightly visible (shows there's more to explore)
      if (node.parent?.parent === focusNode) return 0.4;
      // Deeper: mostly hidden
      if (nodeDepth > focusDepth + 2) return 0.1;
      // Ancestors of focus: visible but subdued
      if (nodeDepth < focusDepth) return 0.15;
      return 0.1;
    },
    [focusNode],
  );

  // Get fill color for a node
  const getFillColor = useCallback(
    (node: PackedNode): string => {
      // Non-leaf nodes get a dark background
      if (node.children && node.children.length > 0) {
        const depth = node.depth;
        const shade = Math.max(15, 30 - depth * 5);
        return `rgb(${shade}, ${shade}, ${shade + 15})`;
      }
      // Leaf nodes: use layer scores or region color
      if (regionScores && colorScale) {
        const score = regionScores.get(node.data.id);
        return scoreToColor(score?.value, colorScale);
      }
      return regionColor(node.data.id);
    },
    [regionScores, colorScale],
  );

  // Loading state
  if (loading) {
    const placeholders = Array.from({ length: 5 }, (_, i) => {
      const cx = width * 0.2 + (i % 3) * (width * 0.3);
      const cy = height * 0.3 + Math.floor(i / 3) * (height * 0.4);
      const r = Math.min(width, height) * 0.08;
      return { cx, cy, r, key: i };
    });
    return (
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        {placeholders.map((p) => (
          <circle
            key={p.key}
            data-skeleton=""
            cx={p.cx}
            cy={p.cy}
            r={p.r}
            fill="#3a3a5c"
            opacity={0.5}
          />
        ))}
      </svg>
    );
  }

  // Empty state
  if (!root || !packed) {
    return (
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <text
          x={width / 2}
          y={height / 2}
          textAnchor="middle"
          fill="#999"
          style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}
        >
          No data available
        </text>
      </svg>
    );
  }

  const transform = `translate(${viewTransform.x},${viewTransform.y}) scale(${viewTransform.k})`;
  const transitionStyle = isTransitioning
    ? `transform ${TRANSITION_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`
    : 'none';

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      onClick={handleBackgroundClick}
      style={{
        fontFamily: 'system-ui, -apple-system, sans-serif',
        cursor: focusNode?.parent ? 'pointer' : 'default',
        background: '#1a1a2e',
      }}
    >
      <defs>
        <filter id="zcp-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="rgba(0,0,0,0.4)" />
        </filter>
      </defs>
      <g
        data-zoom-container=""
        style={{
          transform,
          transition: transitionStyle,
        }}
      >
        {visibleNodes.map((node) => {
          if (node.r < 0.5) return null;

          const isSelected = selectedRegionId === node.data.id;
          const isHovered = hoveredId === node.data.id;
          const opacity = getCircleOpacity(node);
          const showLabel = isLabelVisible(node);
          const fillColor = getFillColor(node);
          const isLeaf = !node.children || node.children.length === 0;
          const hasPendingChildren = node.data.childrenPending;

          // Adaptive font size based on circle radius and zoom
          const effectiveR = node.r * viewTransform.k;
          const fontSize = Math.max(8, Math.min(16, node.r * 0.25));
          const countFontSize = Math.max(7, fontSize * 0.7);

          // Truncate label to fit
          const maxChars = Math.floor((node.r * 2 * 0.75) / (fontSize * 0.55));
          let displayText = node.data.name;
          if (displayText.length > maxChars) {
            displayText = maxChars < 4 ? '' : displayText.slice(0, maxChars - 1) + '\u2026';
          }

          // Tooltip
          const tooltipLines = [node.data.name];
          if (node.data.moduleCount > 0) {
            tooltipLines.push(`${node.data.moduleCount} modules`);
          }
          if (regionScores) {
            const score = regionScores.get(node.data.id);
            if (score) {
              tooltipLines.push(`Score: ${(score.value * 100).toFixed(0)}%`);
              if (score.label) tooltipLines.push(score.label);
            }
          }
          if (hasPendingChildren) {
            tooltipLines.push('Click to load deeper levels');
          }

          return (
            <g
              key={node.data.id}
              style={{
                opacity,
                transition: isTransitioning
                  ? `opacity ${TRANSITION_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`
                  : 'opacity 0.2s',
              }}
              onMouseEnter={() => setHoveredId(node.data.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              <circle
                data-region-id={node.data.id}
                data-depth={node.depth}
                data-selected={isSelected ? 'true' : undefined}
                cx={node.x}
                cy={node.y}
                r={node.r}
                fill={fillColor}
                stroke={
                  isSelected
                    ? '#fff'
                    : isHovered
                      ? 'rgba(255,255,255,0.7)'
                      : isLeaf
                        ? 'rgba(0,0,0,0.25)'
                        : 'rgba(255,255,255,0.1)'
                }
                strokeWidth={isSelected ? 3 / viewTransform.k : isHovered ? 2 / viewTransform.k : 1 / viewTransform.k}
                style={{
                  cursor: 'pointer',
                  filter: isLeaf ? 'url(#zcp-shadow)' : undefined,
                }}
                onClick={(e) => handleCircleClick(node, e)}
              >
                <title>{tooltipLines.join('\n')}</title>
              </circle>

              {/* Label — fades in/out based on focus */}
              {showLabel && displayText && (
                <g
                  style={{
                    opacity: showLabel ? 1 : 0,
                    transition: `opacity ${TRANSITION_MS * 0.6}ms ease`,
                    pointerEvents: 'none',
                  }}
                >
                  <text
                    x={node.x}
                    y={isLeaf ? node.y - countFontSize * 0.3 : node.y}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={fontSize}
                    fontWeight={600}
                    fill="#fff"
                    style={{ textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}
                  >
                    {displayText}
                  </text>
                  {isLeaf && node.data.moduleCount > 0 && effectiveR > 30 && (
                    <text
                      x={node.x}
                      y={node.y + fontSize * 0.7}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={countFontSize}
                      fill="rgba(255,255,255,0.7)"
                      style={{ textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}
                    >
                      {node.data.moduleCount}{' '}
                      {node.data.moduleCount === 1 ? 'module' : 'modules'}
                    </text>
                  )}
                </g>
              )}

              {/* Pending children indicator */}
              {hasPendingChildren && node.parent === focusNode && (
                <text
                  x={node.x}
                  y={node.y + node.r * 0.6}
                  textAnchor="middle"
                  fontSize={Math.max(6, fontSize * 0.6)}
                  fill="rgba(255,255,255,0.5)"
                  style={{ pointerEvents: 'none' }}
                >
                  &#x2026;
                </text>
              )}
            </g>
          );
        })}
      </g>
    </svg>
  );
}
