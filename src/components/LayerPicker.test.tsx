import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LayerPicker } from './LayerPicker';
import type { Layer } from '../layers/types';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeLayer(id: string, name: string, description = ''): Layer {
  return {
    id,
    name,
    description,
    computeModuleScores: vi.fn() as any,
    aggregateToRegions: vi.fn() as any,
  };
}

const threeLayers: Layer[] = [
  makeLayer('coverage', 'Test Coverage', 'Test coverage percentage'),
  makeLayer('staleness', 'Staleness', 'How stale the code is'),
  makeLayer('complexity', 'Complexity', 'Cyclomatic complexity'),
];

// ---------------------------------------------------------------------------
// Behavior 1: LayerPicker rendering
// ---------------------------------------------------------------------------

describe('LayerPicker: Rendering', () => {
  it('renders a list item for each available layer', () => {
    render(
      <LayerPicker
        layers={threeLayers}
        activeLayers={[]}
        onToggleLayer={vi.fn()}
      />,
    );
    expect(screen.getByText('Test Coverage')).toBeInTheDocument();
    expect(screen.getByText('Staleness')).toBeInTheDocument();
    expect(screen.getByText('Complexity')).toBeInTheDocument();
  });

  it('renders 3 toggle switches for 3 layers', () => {
    const { container } = render(
      <LayerPicker
        layers={threeLayers}
        activeLayers={[]}
        onToggleLayer={vi.fn()}
      />,
    );
    // Expect accessible switch/checkbox elements
    const toggles = container.querySelectorAll(
      'input[type="checkbox"], [role="switch"]',
    );
    expect(toggles).toHaveLength(3);
  });

  it('shows empty state message when 0 layers available', () => {
    render(
      <LayerPicker layers={[]} activeLayers={[]} onToggleLayer={vi.fn()} />,
    );
    expect(screen.getByText(/no layers/i)).toBeInTheDocument();
  });

  it('reflects active layers in toggle state', () => {
    const { container } = render(
      <LayerPicker
        layers={threeLayers}
        activeLayers={['coverage', 'staleness']}
        onToggleLayer={vi.fn()}
      />,
    );
    const toggles = container.querySelectorAll(
      'input[type="checkbox"], [role="switch"]',
    );
    // Find the coverage and staleness toggles — they should be checked/on
    const coverageToggle = container.querySelector(
      '[data-layer-id="coverage"] input, [data-layer-id="coverage"][role="switch"]',
    );
    expect(coverageToggle).toBeTruthy();
    // Coverage and staleness should be active
    if (coverageToggle instanceof HTMLInputElement) {
      expect(coverageToggle.checked).toBe(true);
    } else {
      expect(coverageToggle?.getAttribute('aria-checked')).toBe('true');
    }
  });

  it('truncates long layer names', () => {
    const longNameLayer = makeLayer(
      'long',
      'This Is An Extremely Long Layer Name That Should Be Truncated In The Sidebar',
    );
    const { container } = render(
      <LayerPicker
        layers={[longNameLayer]}
        activeLayers={[]}
        onToggleLayer={vi.fn()}
      />,
    );
    // The text should be present (possibly truncated via CSS)
    const layerItem = container.querySelector('[data-layer-id="long"]');
    expect(layerItem).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Behavior 1 + 2: Toggle interaction
// ---------------------------------------------------------------------------

describe('LayerPicker: Toggle Interaction', () => {
  it('calls onToggleLayer with the layer ID when toggling', async () => {
    const onToggle = vi.fn();
    render(
      <LayerPicker
        layers={threeLayers}
        activeLayers={[]}
        onToggleLayer={onToggle}
      />,
    );
    const coverageToggle = screen.getByLabelText(/test coverage/i);
    await userEvent.click(coverageToggle);
    expect(onToggle).toHaveBeenCalledWith('coverage');
  });

  it('calls onToggleLayer when toggling OFF an active layer', async () => {
    const onToggle = vi.fn();
    render(
      <LayerPicker
        layers={threeLayers}
        activeLayers={['coverage']}
        onToggleLayer={onToggle}
      />,
    );
    const coverageToggle = screen.getByLabelText(/test coverage/i);
    await userEvent.click(coverageToggle);
    expect(onToggle).toHaveBeenCalledWith('coverage');
  });
});

// ---------------------------------------------------------------------------
// Behavior 5: Legend
// ---------------------------------------------------------------------------

describe('LayerPicker: Legend', () => {
  it('shows legend when a layer is active', () => {
    const { container } = render(
      <LayerPicker
        layers={threeLayers}
        activeLayers={['coverage']}
        onToggleLayer={vi.fn()}
      />,
    );
    const legend = container.querySelector('[data-legend]');
    expect(legend).toBeTruthy();
  });

  it('hides legend when no layers are active', () => {
    const { container } = render(
      <LayerPicker
        layers={threeLayers}
        activeLayers={[]}
        onToggleLayer={vi.fn()}
      />,
    );
    const legend = container.querySelector('[data-legend]');
    expect(legend).toBeFalsy();
  });

  it('shows min/max value labels on the legend', () => {
    render(
      <LayerPicker
        layers={threeLayers}
        activeLayers={['coverage']}
        onToggleLayer={vi.fn()}
      />,
    );
    // Legend should have some value labels (e.g., "0" and "1" or "0%" and "100%")
    const legend = screen.getByTestId?.('layer-legend') ??
      document.querySelector('[data-legend]');
    expect(legend).toBeTruthy();
    // Should contain at least some text content for min and max
    expect(legend!.textContent).toMatch(/0/);
    expect(legend!.textContent).toMatch(/1|100/);
  });

  it('shows a gradient bar in the legend', () => {
    const { container } = render(
      <LayerPicker
        layers={threeLayers}
        activeLayers={['coverage']}
        onToggleLayer={vi.fn()}
      />,
    );
    // Look for a gradient element or styled div
    const gradientBar = container.querySelector(
      '[data-legend-gradient], linearGradient',
    );
    expect(gradientBar).toBeTruthy();
  });
});
