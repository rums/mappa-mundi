import React, { useState, useCallback, useMemo } from 'react';
import type { SemanticZoomLevel, RelationshipKind } from '../types';
import { computeTreemapLayout, type LayoutRect } from '../utils/layout';
import { regionColor } from '../utils/color';

interface MapRendererProps {
  data: SemanticZoomLevel | null;
  loading: boolean;
  width?: number;
  height?: number;
  regionSizeBy?: 'modules' | 'loc';
  onZoomIn?: (regionId: string) => void;
  onRegionSelect?: (regionId: string) => void;
}

const DASH_PATTERNS: Record<RelationshipKind, string> = {
  'depends-on': 'none',
  extends: '8,4',
  implements: '4,4',
  uses: '2,2',
};

export function MapRenderer({
  data,
  loading,
  width = 960,
  height = 540,
  regionSizeBy = 'modules',
  onZoomIn,
  onRegionSelect,
}: MapRendererProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState({ scale: 1, x: 0, y: 0 });

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
      // Only deselect if clicking on the SVG itself (not bubbling from a child)
      if (e.target === e.currentTarget) {
        setSelectedId(null);
      }
    },
    [],
  );

  const handleRectClick = useCallback(
    (regionId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      setSelectedId(regionId);
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
              stroke="#999"
              strokeWidth={Math.max(1, Number(rel.edgeCount) || 1)}
              strokeDasharray={dashArray === 'none' ? undefined : dashArray}
            />
          );
        })}
        {/* Regions */}
        {layout.map((rect) => {
          const isSelected = selectedId === rect.regionId;
          const region = regionMap.get(rect.regionId);
          return (
            <g key={rect.regionId}>
              <rect
                data-region-id={rect.regionId}
                data-selected={isSelected ? 'true' : undefined}
                x={rect.x}
                y={rect.y}
                width={rect.width}
                height={rect.height}
                fill={regionColor(rect.regionId)}
                stroke={isSelected ? '#000' : '#fff'}
                strokeWidth={isSelected ? 3 : 1}
                style={{ cursor: 'pointer' }}
                onClick={(e) => handleRectClick(rect.regionId, e)}
                onDoubleClick={(e) => handleRectDblClick(rect.regionId, e)}
              />
              <text
                data-region-id={rect.regionId}
                x={rect.x + rect.width / 2}
                y={rect.y + rect.height / 2}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={12}
                fill="#fff"
                pointerEvents="none"
              >
                {region?.name ?? rect.regionId}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}
