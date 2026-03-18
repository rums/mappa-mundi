import React from 'react';
import type { LayerScore } from '../layers/types';
import type { ColorScale } from '../utils/colorScale';
import { scoreToColor } from '../utils/colorScale';

interface LayerDetailPanelProps {
  regionId: string;
  regionName: string;
  moduleScores: Map<string, LayerScore>;
  layerName: string;
  colorScale: ColorScale;
  onClose: () => void;
}

export function LayerDetailPanel({
  regionId,
  regionName,
  moduleScores,
  layerName,
  colorScale,
  onClose,
}: LayerDetailPanelProps) {
  const entries = Array.from(moduleScores.entries());

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>{regionName}</h2>
        <button onClick={onClose} aria-label="Close">Close</button>
      </div>
      <h3>{layerName}</h3>
      {entries.length === 0 ? (
        <p>No scores data</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {entries.map(([modulePath, score]) => {
            const fileName = modulePath.split('/').pop() ?? modulePath;
            const color = scoreToColor(score.value, colorScale);
            return (
              <li key={modulePath} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  data-score-color
                  style={{ width: 12, height: 12, backgroundColor: color, display: 'inline-block', borderRadius: '50%' }}
                />
                <span>{fileName}</span>
                <span>{score.label}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
