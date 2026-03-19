import React, { useState, useCallback, useMemo } from 'react';
import type { SemanticZoomLevel, RelationshipKind } from '../types';
import { computeTreemapLayout, type LayoutRect } from '../utils/layout';
import { regionColor } from '../utils/color';
import { scoreToColor } from '../utils/colorScale';
import type { ColorScale } from '../utils/colorScale';
import type { LayerScore } from '../layers/types';

interface MapRendererProps {
  data: SemanticZoomLevel | null;
  loading: boolean;
  width?: number;
  height?: number;
  regionSizeBy?: 'modules' | 'loc';
  onZoomIn?: (regionId: string) => void;
  onRegionSelect?: (regionId: string) => void;
  regionScores?: Map<string, LayerScore>;
  colorScale?: ColorScale;
  selectedRegionId?: string | null;
}

const DASH_PATTERNS: Record<RelationshipKind, string> = {
  'depends-on': 'none',
  extends: '8,4',
  implements: '4,4',
  uses: '2,2',
};

/** Pick a font size that fits within the rect, clamped to reasonable bounds. */
function fitFontSize(text: string, rectWidth: number, rectHeight: number): number {
  const maxByWidth = (rectWidth - 8) / (text.length * 0.55);
  const maxByHeight = (rectHeight - 4) / 1.5;
  return Math.max(7, Math.min(16, maxByWidth, maxByHeight));
}

/** Truncate text to fit roughly within a pixel width. */
function fitText(text: string, rectWidth: number, fontSize: number): string {
  const charWidth = fontSize * 0.55;
  const maxChars = Math.floor((rectWidth - 8) / charWidth);
  if (text.length <= maxChars) return text;
  if (maxChars < 4) return '';
  return text.slice(0, maxChars - 1) + '…';
}

export function MapRenderer({
  data,
  loading,
  width = 960,
  height = 540,
  regionSizeBy = 'modules',
  onZoomIn,
  onRegionSelect,
  regionScores,
  colorScale,
  selectedRegionId,
}: MapRendererProps) {
  const [internalSelectedId, setInternalSelectedId] = useState<string | null>(null);
  const selectedId = selectedRegionId !== undefined ? selectedRegionId : internalSelectedId;
  const [zoom, setZoom] = useState({ scale: 1, x: 0, y: 0 });
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const layout = useMemo(() => {
    if (!data || data.regions.length === 0) return [];
    return computeTreemapLayout(data.regions, width, height, regionSizeBy);
  }, [data, width, height, regionSizeBy]);

  const rectMap = useMemo(() => {
    const map = new Map<string, LayoutRect>();
    for (const r of layout) {
      map.set(r.regionId, r);
    }
    return map;
  }, [layout]);

  const regionMap = useMemo(() => {
    const map = new Map<string, SemanticZoomLevel['regions'][number]>();
    if (!data) return map;
    for (const r of data.regions) {
      map.set(r.id, r);
    }
    return map;
  }, [data]);

  const handleWheel = useCallback(
    (e: React.WheelEvent<SVGSVGElement>) => {
      e.preventDefault();
      setZoom((prev) => {
        const factor = e.deltaY < 0 ? 1.1 : 0.9;
        const newScale = Math.min(4, Math.max(0.25, prev.scale * factor));
        return { ...prev, scale: newScale };
      });
    },
    [],
  );

  const handleSvgClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (e.target === e.currentTarget) {
        setInternalSelectedId(null);
      }
    },
    [],
  );

  const handleRectClick = useCallback(
    (regionId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      setInternalSelectedId(regionId);
      onRegionSelect?.(regionId);
    },
    [onRegionSelect],
  );

  const handleRectDblClick = useCallback(
    (regionId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      onZoomIn?.(regionId);
    },
    [onZoomIn],
  );

  // Loading state
  if (loading) {
    return (
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        {Array.from({ length: 5 }, (_, i) => (
          <rect
            key={i}
            data-skeleton=""
            x={10 + (i % 3) * (width / 3)}
            y={10 + Math.floor(i / 3) * (height / 2)}
            width={width / 3 - 20}
            height={height / 2 - 20}
            fill="#e0e0e0"
            rx={4}
          />
        ))}
      </svg>
    );
  }

  // Empty state
  if (!data || data.regions.length === 0) {
    return (
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <text x={width / 2} y={height / 2} textAnchor="middle">
          No data available
        </text>
      </svg>
    );
  }

  const transform = `translate(${zoom.x},${zoom.y}) scale(${zoom.scale})`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      onWheel={handleWheel}
      onClick={handleSvgClick}
      style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}
    >
      <g data-zoom-container="" transform={transform}>
        {/* Edges */}
        {data.relationships.map((rel, i) => {
          const source = rectMap.get(rel.sourceId);
          const target = rectMap.get(rel.targetId);
          if (!source || !target) return null;
          const sx = source.x + source.width / 2;
          const sy = source.y + source.height / 2;
          const tx = target.x + target.width / 2;
          const ty = target.y + target.height / 2;
          const mx = (sx + tx) / 2;
          const dashArray = DASH_PATTERNS[rel.kind];
          return (
            <path
              key={`edge-${i}`}
              data-edge=""
              d={`M ${sx},${sy} C ${mx},${sy} ${mx},${ty} ${tx},${ty}`}
              fill="none"
              stroke="rgba(255,255,255,0.3)"
              strokeWidth={Math.max(1, Math.min(4, Number(rel.edgeCount) || 1))}
              strokeDasharray={dashArray === 'none' ? undefined : dashArray}
              pointerEvents="none"
            />
          );
        })}
        {/* Regions */}
        {layout.map((rect) => {
          const isSelected = selectedId === rect.regionId;
          const isHovered = hoveredId === rect.regionId;
          const region = regionMap.get(rect.regionId);
          const score = regionScores?.get(rect.regionId);
          const fillColor = regionScores && colorScale
            ? scoreToColor(score?.value, colorScale)
            : regionColor(rect.regionId);

          const name = region?.name ?? rect.regionId;
          const fontSize = fitFontSize(name, rect.width, rect.height);
          const displayText = fitText(name, rect.width, fontSize);
          const showLabel = rect.width > 20 && rect.height > 14;

          // Module count subtitle
          const moduleCount = region?.moduleCount ?? 0;
          const showCount = rect.height > 30 && rect.width > 50;

          // Tooltip text
          const tooltipLines = [name];
          if (moduleCount > 0) tooltipLines.push(`${moduleCount} modules`);
          if (score) tooltipLines.push(`Score: ${(score.value * 100).toFixed(0)}%`);
          if (score?.label) tooltipLines.push(score.label);

          return (
            <g
              key={rect.regionId}
              onMouseEnter={() => setHoveredId(rect.regionId)}
              onMouseLeave={() => setHoveredId(null)}
            >
              <rect
                data-region-id={rect.regionId}
                data-selected={isSelected ? 'true' : undefined}
                x={rect.x}
                y={rect.y}
                width={rect.width}
                height={rect.height}
                fill={fillColor}
                stroke={isSelected ? '#fff' : isHovered ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.2)'}
                strokeWidth={isSelected ? 3 : isHovered ? 2 : 0.5}
                style={{ cursor: 'pointer', transition: 'stroke-width 0.15s' }}
                rx={2}
                onClick={(e) => handleRectClick(rect.regionId, e)}
                onDoubleClick={(e) => handleRectDblClick(rect.regionId, e)}
              >
                <title>{tooltipLines.join('\n')}</title>
              </rect>
              {showLabel && (
                <>
                  <text
                    data-region-id={rect.regionId}
                    x={rect.x + rect.width / 2}
                    y={rect.y + (showCount ? rect.height / 2 - fontSize * 0.3 : rect.height / 2)}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={fontSize}
                    fontWeight={600}
                    fill="#fff"
                    style={{ textShadow: '0 1px 3px rgba(0,0,0,0.6)' }}
                    pointerEvents="none"
                  >
                    {displayText}
                  </text>
                  {showCount && (
                    <text
                      x={rect.x + rect.width / 2}
                      y={rect.y + rect.height / 2 + fontSize * 0.8}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={Math.max(7, fontSize * 0.7)}
                      fill="rgba(255,255,255,0.7)"
                      pointerEvents="none"
                    >
                      {moduleCount} {moduleCount === 1 ? 'module' : 'modules'}
                    </text>
                  )}
                </>
              )}
            </g>
          );
        })}
      </g>
    </svg>
  );
}
