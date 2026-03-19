import React, { useState, useRef, useEffect } from 'react';
import type { Lens, LensType } from '../lenses/types.js';

interface LensPickerProps {
  compoundLenses: Lens[];
  layerLenses: Lens[];
  activeCompoundLensId: string | null;
  onSelectCompoundLens: (id: string | null) => void;
  onCreateLens: (name: string, type: LensType, prompt: string) => void;
  onDeleteLens: (id: string) => void;
}

export function LensPicker({
  compoundLenses,
  layerLenses,
  activeCompoundLensId,
  onSelectCompoundLens,
  onCreateLens,
  onDeleteLens,
}: LensPickerProps) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState<LensType | null>(null);
  const [newName, setNewName] = useState('');
  const [newPrompt, setNewPrompt] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
        setCreating(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const activeLens = compoundLenses.find(l => l.id === activeCompoundLensId);
  const label = activeLens ? activeLens.name : 'Default grouping';

  const handleCreate = () => {
    if (newName.trim() && newPrompt.trim() && creating) {
      onCreateLens(newName.trim(), creating, newPrompt.trim());
      setNewName('');
      setNewPrompt('');
      setCreating(null);
    }
  };

  return (
    <div ref={dropdownRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setOpen(!open)}
        data-testid="lens-picker-toggle"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '4px 8px',
          border: '1px solid #ccc',
          borderRadius: 4,
          background: 'white',
          cursor: 'pointer',
          fontSize: 13,
        }}
      >
        <span style={{ fontSize: 14 }}>&#128269;</span>
        {label}
        <span style={{ fontSize: 10, marginLeft: 4 }}>{open ? '\u25B2' : '\u25BC'}</span>
      </button>

      {open && (
        <div
          data-testid="lens-picker-dropdown"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 4,
            background: 'white',
            border: '1px solid #ccc',
            borderRadius: 4,
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            zIndex: 100,
            minWidth: 280,
            maxHeight: 400,
            overflowY: 'auto',
          }}
        >
          {/* Compound lenses section */}
          <div style={{ padding: '8px 12px', borderBottom: '1px solid #eee' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase', marginBottom: 4 }}>
              Compound Lenses (grouping)
            </div>
            <div
              data-testid="lens-option-default"
              onClick={() => { onSelectCompoundLens(null); setOpen(false); }}
              style={{
                padding: '4px 8px',
                cursor: 'pointer',
                borderRadius: 3,
                background: !activeCompoundLensId ? '#e3f2fd' : 'transparent',
              }}
            >
              Default grouping
            </div>
            {compoundLenses.map(lens => (
              <div
                key={lens.id}
                data-testid={`lens-option-${lens.id}`}
                style={{
                  padding: '4px 8px',
                  cursor: 'pointer',
                  borderRadius: 3,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  background: activeCompoundLensId === lens.id ? '#e3f2fd' : 'transparent',
                }}
              >
                <span onClick={() => { onSelectCompoundLens(lens.id); setOpen(false); }} style={{ flex: 1 }}>
                  {lens.name}
                </span>
                <button
                  data-testid={`delete-lens-${lens.id}`}
                  onClick={(e) => { e.stopPropagation(); onDeleteLens(lens.id); }}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    color: '#999',
                    fontSize: 14,
                    padding: '0 4px',
                  }}
                  title="Delete lens"
                >
                  &#x2715;
                </button>
              </div>
            ))}
            <button
              data-testid="new-compound-lens"
              onClick={() => setCreating('compound')}
              style={{
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                color: '#1976d2',
                fontSize: 12,
                padding: '4px 8px',
                marginTop: 4,
              }}
            >
              + New compound lens
            </button>
          </div>

          {/* Layer lenses section */}
          <div style={{ padding: '8px 12px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase', marginBottom: 4 }}>
              Layer Lenses (scoring)
            </div>
            {layerLenses.length === 0 && (
              <div style={{ fontSize: 12, color: '#999', padding: '4px 8px' }}>
                Layer lenses appear in the layer picker
              </div>
            )}
            {layerLenses.map(lens => (
              <div
                key={lens.id}
                style={{
                  padding: '4px 8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  fontSize: 13,
                }}
              >
                <span style={{ color: '#666' }}>{lens.name}</span>
                <button
                  data-testid={`delete-lens-${lens.id}`}
                  onClick={() => onDeleteLens(lens.id)}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    color: '#999',
                    fontSize: 14,
                    padding: '0 4px',
                  }}
                  title="Delete lens"
                >
                  &#x2715;
                </button>
              </div>
            ))}
            <button
              data-testid="new-layer-lens"
              onClick={() => setCreating('layer')}
              style={{
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                color: '#1976d2',
                fontSize: 12,
                padding: '4px 8px',
                marginTop: 4,
              }}
            >
              + New layer lens
            </button>
          </div>

          {/* Creation form */}
          {creating && (
            <div style={{ padding: '8px 12px', borderTop: '1px solid #eee', background: '#fafafa' }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                New {creating} lens
              </div>
              <input
                data-testid="lens-name-input"
                type="text"
                placeholder="Lens name"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                style={{ width: '100%', marginBottom: 4, padding: '4px 6px', fontSize: 12, boxSizing: 'border-box' }}
              />
              <textarea
                data-testid="lens-prompt-input"
                placeholder={
                  creating === 'compound'
                    ? 'How should code be grouped? e.g. "Group by team ownership..."'
                    : 'What should be scored? e.g. "Rate by change risk..."'
                }
                value={newPrompt}
                onChange={e => setNewPrompt(e.target.value)}
                rows={3}
                style={{ width: '100%', marginBottom: 4, padding: '4px 6px', fontSize: 12, boxSizing: 'border-box', resize: 'vertical' }}
              />
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  data-testid="lens-create-submit"
                  onClick={handleCreate}
                  disabled={!newName.trim() || !newPrompt.trim()}
                  style={{ fontSize: 12, padding: '4px 8px' }}
                >
                  Create
                </button>
                <button
                  onClick={() => { setCreating(null); setNewName(''); setNewPrompt(''); }}
                  style={{ fontSize: 12, padding: '4px 8px' }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
