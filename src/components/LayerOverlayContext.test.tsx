import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  LayerOverlayProvider,
  useLayerOverlay,
} from './LayerOverlayContext';
import type { Layer } from '../layers/types';

// ---------------------------------------------------------------------------
// Test helper: a component that consumes the context
// ---------------------------------------------------------------------------

function TestConsumer() {
  const { activeLayers, toggleLayer, activeColorScale, activeLayerScores } =
    useLayerOverlay();
  return (
    <div>
      <span data-testid="active-count">{activeLayers.length}</span>
      <span data-testid="active-ids">{activeLayers.join(',')}</span>
      <span data-testid="has-scores">
        {activeLayerScores ? 'yes' : 'no'}
      </span>
      <span data-testid="has-scale">
        {activeColorScale ? 'yes' : 'no'}
      </span>
      <button onClick={() => toggleLayer('coverage')}>toggle-coverage</button>
      <button onClick={() => toggleLayer('staleness')}>toggle-staleness</button>
      <button onClick={() => toggleLayer('complexity')}>toggle-complexity</button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Behavior 3: Multi-layer precedence (last-activated-wins)
// ---------------------------------------------------------------------------

describe('LayerOverlayContext: Active Layer Management', () => {
  it('starts with no active layers', () => {
    render(
      <LayerOverlayProvider>
        <TestConsumer />
      </LayerOverlayProvider>,
    );
    expect(screen.getByTestId('active-count').textContent).toBe('0');
  });

  it('activates a layer when toggled ON', async () => {
    render(
      <LayerOverlayProvider>
        <TestConsumer />
      </LayerOverlayProvider>,
    );
    await userEvent.click(screen.getByText('toggle-coverage'));
    expect(screen.getByTestId('active-ids').textContent).toBe('coverage');
  });

  it('deactivates a layer when toggled OFF', async () => {
    render(
      <LayerOverlayProvider>
        <TestConsumer />
      </LayerOverlayProvider>,
    );
    // Toggle ON then OFF
    await userEvent.click(screen.getByText('toggle-coverage'));
    await userEvent.click(screen.getByText('toggle-coverage'));
    expect(screen.getByTestId('active-count').textContent).toBe('0');
  });

  it('maintains activation order — most recently activated last', async () => {
    render(
      <LayerOverlayProvider>
        <TestConsumer />
      </LayerOverlayProvider>,
    );
    await userEvent.click(screen.getByText('toggle-coverage'));
    await userEvent.click(screen.getByText('toggle-staleness'));
    const ids = screen.getByTestId('active-ids').textContent;
    // staleness should be last (most recently activated)
    expect(ids).toBe('coverage,staleness');
  });

  it('last-activated-wins: most recent layer controls display', async () => {
    render(
      <LayerOverlayProvider>
        <TestConsumer />
      </LayerOverlayProvider>,
    );
    await userEvent.click(screen.getByText('toggle-coverage'));
    await userEvent.click(screen.getByText('toggle-staleness'));
    // The active IDs list has staleness last → it is the display layer
    const ids = screen.getByTestId('active-ids').textContent!;
    const layers = ids.split(',');
    expect(layers[layers.length - 1]).toBe('staleness');
  });

  it('deactivating top layer reveals next-most-recent', async () => {
    render(
      <LayerOverlayProvider>
        <TestConsumer />
      </LayerOverlayProvider>,
    );
    await userEvent.click(screen.getByText('toggle-coverage'));
    await userEvent.click(screen.getByText('toggle-staleness'));
    // Deactivate staleness
    await userEvent.click(screen.getByText('toggle-staleness'));
    const ids = screen.getByTestId('active-ids').textContent;
    expect(ids).toBe('coverage');
  });

  it('re-activating a layer moves it to most recent', async () => {
    render(
      <LayerOverlayProvider>
        <TestConsumer />
      </LayerOverlayProvider>,
    );
    await userEvent.click(screen.getByText('toggle-coverage'));
    await userEvent.click(screen.getByText('toggle-staleness'));
    // Re-activate coverage (toggle off then on)
    await userEvent.click(screen.getByText('toggle-coverage'));
    await userEvent.click(screen.getByText('toggle-coverage'));
    const ids = screen.getByTestId('active-ids').textContent!;
    const layers = ids.split(',');
    expect(layers[layers.length - 1]).toBe('coverage');
  });

  it('deactivating the only remaining layer returns to no active layers', async () => {
    render(
      <LayerOverlayProvider>
        <TestConsumer />
      </LayerOverlayProvider>,
    );
    await userEvent.click(screen.getByText('toggle-coverage'));
    await userEvent.click(screen.getByText('toggle-coverage'));
    expect(screen.getByTestId('active-count').textContent).toBe('0');
    expect(screen.getByTestId('has-scores').textContent).toBe('no');
    expect(screen.getByTestId('has-scale').textContent).toBe('no');
  });
});
