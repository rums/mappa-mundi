import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LayerDetailPanel } from './LayerDetailPanel';
import type { LayerScore } from '../layers/types';
import type { ColorScale } from '../utils/colorScale';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const coverageScale: ColorScale = {
  low: '#d32f2f',
  high: '#388e3c',
};

function makeModuleScores(): Map<string, LayerScore> {
  const scores = new Map<string, LayerScore>();
  scores.set('src/auth/login.ts', {
    value: 0.95,
    raw: 95,
    label: '95% coverage',
    severity: 'info',
  });
  scores.set('src/auth/signup.ts', {
    value: 0.45,
    raw: 45,
    label: '45% coverage',
    severity: 'warning',
  });
  scores.set('src/auth/reset.ts', {
    value: 0.2,
    raw: 20,
    label: '20% coverage',
    severity: 'critical',
  });
  return scores;
}

// ---------------------------------------------------------------------------
// Behavior 4: Detail panel rendering
// ---------------------------------------------------------------------------

describe('LayerDetailPanel: Rendering', () => {
  it('displays the region name and layer name', () => {
    render(
      <LayerDetailPanel
        regionId="auth"
        regionName="Authentication"
        moduleScores={makeModuleScores()}
        layerName="Test Coverage"
        colorScale={coverageScale}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('Authentication')).toBeInTheDocument();
    expect(screen.getByText(/test coverage/i)).toBeInTheDocument();
  });

  it('shows per-module scores with module names', () => {
    render(
      <LayerDetailPanel
        regionId="auth"
        regionName="Authentication"
        moduleScores={makeModuleScores()}
        layerName="Test Coverage"
        colorScale={coverageScale}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/login/i)).toBeInTheDocument();
    expect(screen.getByText(/signup/i)).toBeInTheDocument();
    expect(screen.getByText(/reset/i)).toBeInTheDocument();
  });

  it('shows score labels for each module', () => {
    render(
      <LayerDetailPanel
        regionId="auth"
        regionName="Authentication"
        moduleScores={makeModuleScores()}
        layerName="Test Coverage"
        colorScale={coverageScale}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/95%/)).toBeInTheDocument();
    expect(screen.getByText(/45%/)).toBeInTheDocument();
    expect(screen.getByText(/20%/)).toBeInTheDocument();
  });

  it('color-codes each module score row', () => {
    const { container } = render(
      <LayerDetailPanel
        regionId="auth"
        regionName="Authentication"
        moduleScores={makeModuleScores()}
        layerName="Test Coverage"
        colorScale={coverageScale}
        onClose={vi.fn()}
      />,
    );
    // Each module row should have a color indicator
    const colorIndicators = container.querySelectorAll('[data-score-color]');
    expect(colorIndicators.length).toBeGreaterThanOrEqual(3);
  });

  it('renders empty state for region with no module scores', () => {
    render(
      <LayerDetailPanel
        regionId="empty"
        regionName="Empty Region"
        moduleScores={new Map()}
        layerName="Test Coverage"
        colorScale={coverageScale}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/no.*scores|no.*data/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Behavior 4: Close interaction
// ---------------------------------------------------------------------------

describe('LayerDetailPanel: Close', () => {
  it('calls onClose when close button is clicked', async () => {
    const onClose = vi.fn();
    render(
      <LayerDetailPanel
        regionId="auth"
        regionName="Authentication"
        moduleScores={makeModuleScores()}
        layerName="Test Coverage"
        colorScale={coverageScale}
        onClose={onClose}
      />,
    );
    const closeButton = screen.getByRole('button', { name: /close/i });
    await userEvent.click(closeButton);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
