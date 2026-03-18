import React from 'react';
import type { Layer } from '../layers/types';

interface LayerPickerProps {
  layers: Layer[];
  activeLayers: string[];
  onToggleLayer: (id: string) => void;
}

export function LayerPicker({ layers, activeLayers, onToggleLayer }: LayerPickerProps) {
  if (layers.length === 0) {
    return <div>No layers</div>;
  }

  return (
    <div>
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {layers.map((layer) => (
          <li key={layer.id} data-layer-id={layer.id}>
            <label style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
              <input
                type="checkbox"
                aria-label={layer.name}
                checked={activeLayers.includes(layer.id)}
                onChange={() => onToggleLayer(layer.id)}
              />
              {layer.name}
            </label>
          </li>
        ))}
      </ul>
      {activeLayers.length > 0 && (
        <div data-legend data-testid="layer-legend">
          <span>0</span>
          <div data-legend-gradient style={{ height: 12, background: 'linear-gradient(to right, #d32f2f, #388e3c)' }} />
          <span>1</span>
        </div>
      )}
    </div>
  );
}
