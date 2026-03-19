import React, { useState, useCallback, useMemo } from 'react';
import * as d3 from 'd3';
import type { SemanticZoomLevel, RelationshipKind } from '../types';
import { regionColor } from '../utils/color';
import { scoreToColor } from '../utils/colorScale';
import type { ColorScale } from '../utils/colorScale';
import type { LayerScore } from '../layers/types';

interface CirclePackRendererProps {
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

interface CircleNode {
  regionId: string;
  name: string;
  moduleCount: number;
  x: number;
  y: number;
  r: number;
}

export function CirclePackRenderer({
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
}: CirclePackRendererProps) {
  const [internalSelectedId, setInternalSelectedId] = useState<string | null>(null);
  const selectedId = selectedRegionId !== undefined ? selectedRegionId : internalSelectedId;
  const [zoom, setZoom] = useState({ scale: 1, x: 0, y: 0 });
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const circles = useMemo((): CircleNode[] => {
    if (!data || data.regions.length === 0) return [];

    const hierarchyData = {
      name: 'root',
      children: data.regions.map((r) => ({
        name: r.name,
        regionId: r.id,
        moduleCount: r.moduleCount,
        value: Math.max(1, regionSizeBy === 'loc' ? r.loc : r.moduleCount),
      })),
    };

    const root = d3
      .hierarchy(hierarchyData)
      .sum((d: any) => d.value ?? 0);

    const packLayout = d3
      .pack<typeof hierarchyData>()
      .size([width, height])
      .padding(6);

    const packed = packLayout(root);

    return packed.children?.map((node) => ({
      regionId: (node.data as any).regionId,
      name: (node.data as any).name,
      moduleCount: (node.data as any).moduleCount,
      x: node.x,
      y: node.y,
      r: node.r,
    })) ?? [];
  }, [data, width, height, regionSizeBy]);

  const circleMap = useMemo(() => {
    const map = new Map<string, CircleNode>();
    for (const c of circles) {
      map.set(c.regionId, c);
    }
    return map;
  }, [circles]);

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

  const handleCircleClick = useCallback(
    (regionId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      setInternalSelectedId(regionId);
      onRegionSelect?.(regionId);
    },
    [onRegionSelect],
  );

  const handleCircleDblClick = useCallback(
    (regionId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      onZoomIn?.(regionId);
    },
    [onZoomIn],
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
  if (!data || data.regions.length === 0) {
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
      <defs>
        <filter id="circle-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="rgba(0,0,0,0.4)" />
        </filter>
      </defs>
      <g data-zoom-container="" transform={transform}>
        {/* Relationship edges */}
        {data.relationships.map((rel, i) => {
          const source = circleMap.get(rel.sourceId);
          const target = circleMap.get(rel.targetId);
          if (!source || !target) return null;
          const sx = source.x;
          const sy = source.y;
          const tx = target.x;
          const ty = target.y;
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

        {/* Circles */}
        {circles.map((circle) => {
          const isSelected = selectedId === circle.regionId;
          const isHovered = hoveredId === circle.regionId;
          const score = regionScores?.get(circle.regionId);
          const fillColor =
            regionScores && colorScale
              ? scoreToColor(score?.value, colorScale)
              : regionColor(circle.regionId);

          const showLabel = circle.r > 18;
          const showCount = circle.r > 35;
          const fontSize = Math.max(8, Math.min(16, circle.r * 0.3));
          const countFontSize = Math.max(7, fontSize * 0.7);

          // Truncate name to fit
          const maxChars = Math.floor((circle.r * 2 * 0.8) / (fontSize * 0.55));
          let displayText = circle.name;
          if (displayText.length > maxChars) {
            if (maxChars < 4) {
              displayText = '';
            } else {
              displayText = displayText.slice(0, maxChars - 1) + '\u2026';
            }
          }

          // Tooltip
          const tooltipLines = [circle.name];
          if (circle.moduleCount > 0)
            tooltipLines.push(`${circle.moduleCount} modules`);
          if (score)
            tooltipLines.push(`Score: ${(score.value * 100).toFixed(0)}%`);
          if (score?.label) tooltipLines.push(score.label);

          return (
            <g
              key={circle.regionId}
              onMouseEnter={() => setHoveredId(circle.regionId)}
              onMouseLeave={() => setHoveredId(null)}
            >
              <circle
                data-region-id={circle.regionId}
                data-selected={isSelected ? 'true' : undefined}
                cx={circle.x}
                cy={circle.y}
                r={circle.r}
                fill={fillColor}
                stroke={
                  isSelected
                    ? '#fff'
                    : isHovered
                      ? 'rgba(255,255,255,0.7)'
                      : 'rgba(0,0,0,0.25)'
                }
                strokeWidth={isSelected ? 3 : isHovered ? 2 : 1}
                style={{
                  cursor: 'pointer',
                  transition: 'stroke-width 0.15s, stroke 0.15s',
                  filter: 'url(#circle-shadow)',
                }}
                onClick={(e) => handleCircleClick(circle.regionId, e)}
                onDoubleClick={(e) => handleCircleDblClick(circle.regionId, e)}
              >
                <title>{tooltipLines.join('\n')}</title>
              </circle>
              {showLabel && displayText && (
                <>
                  <text
                    data-region-id={circle.regionId}
                    x={circle.x}
                    y={showCount ? circle.y - countFontSize * 0.4 : circle.y}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={fontSize}
                    fontWeight={600}
                    fill="#fff"
                    style={{ textShadow: '0 1px 3px rgba(0,0,0,0.7)' }}
                    pointerEvents="none"
                  >
                    {displayText}
                  </text>
                  {showCount && (
                    <text
                      x={circle.x}
                      y={circle.y + fontSize * 0.7}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={countFontSize}
                      fill="rgba(255,255,255,0.7)"
                      style={{ textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}
                      pointerEvents="none"
                    >
                      {circle.moduleCount}{' '}
                      {circle.moduleCount === 1 ? 'module' : 'modules'}
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
