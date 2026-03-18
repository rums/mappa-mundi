import * as d3 from 'd3';
import type { Region } from '../types';

export type LayoutRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  regionId: string;
};

export function computeTreemapLayout(
  regions: Region[],
  width: number,
  height: number,
  sizeBy: 'modules' | 'loc',
): LayoutRect[] {
  if (regions.length === 0) return [];

  const root = d3
    .hierarchy({ id: 'root', children: regions } as any)
    .sum((d: any) =>
      d.children ? 0 : sizeBy === 'modules' ? d.moduleCount : d.loc,
    );

  const treemap = d3.treemap<any>().size([width, height]).padding(1).round(true);

  treemap(root);

  return root.leaves().map((leaf: any) => ({
    x: leaf.x0,
    y: leaf.y0,
    width: leaf.x1 - leaf.x0,
    height: leaf.y1 - leaf.y0,
    regionId: leaf.data.id,
  }));
}
