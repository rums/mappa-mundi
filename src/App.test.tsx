import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';

// ---------------------------------------------------------------------------
// Behavior 1: Layout — Header, Map Area, Sidebar
// ---------------------------------------------------------------------------

describe('App: Layout Structure', () => {
  it('renders header with app title "Mappa Mundi"', () => {
    render(<App />);
    expect(screen.getByText('Mappa Mundi')).toBeInTheDocument();
  });

  it('renders a header element', () => {
    const { container } = render(<App />);
    const header = container.querySelector('header');
    expect(header).toBeTruthy();
  });

  it('renders a map-container placeholder area', () => {
    const { container } = render(<App />);
    const mapContainer = container.querySelector('.map-container');
    expect(mapContainer).toBeTruthy();
  });

  it('renders a sidebar placeholder area', () => {
    const { container } = render(<App />);
    const sidebar = container.querySelector('.sidebar');
    expect(sidebar).toBeTruthy();
  });

  it('shows "Scan a project to begin" placeholder in map area when no data', () => {
    render(<App />);
    expect(screen.getByText(/scan a project to begin/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Behavior 2: Scan Trigger UI — Path Input + Button
// ---------------------------------------------------------------------------

describe('App: Scan Trigger UI', () => {
  it('renders a project path text input', () => {
    render(<App />);
    const input = screen.getByRole('textbox');
    expect(input).toBeInTheDocument();
  });

  it('renders a "Scan" button', () => {
    render(<App />);
    const button = screen.getByRole('button', { name: /scan/i });
    expect(button).toBeInTheDocument();
  });

  it('scan button is disabled when input is empty', () => {
    render(<App />);
    const button = screen.getByRole('button', { name: /scan/i });
    expect(button).toBeDisabled();
  });

  it('scan button is enabled when input has a path value', async () => {
    const user = userEvent.setup();
    render(<App />);
    const input = screen.getByRole('textbox');
    await user.type(input, '/home/user/my-project');
    const button = screen.getByRole('button', { name: /scan/i });
    expect(button).toBeEnabled();
  });

  it('binds input value to projectPath state', async () => {
    const user = userEvent.setup();
    render(<App />);
    const input = screen.getByRole('textbox');
    await user.type(input, '/some/path');
    expect(input).toHaveValue('/some/path');
  });
});

// ---------------------------------------------------------------------------
// Behavior 3: Status Indicator
// ---------------------------------------------------------------------------

describe('App: Status Indicator', () => {
  it('shows "idle" status initially', () => {
    render(<App />);
    expect(screen.getByText(/idle/i)).toBeInTheDocument();
  });

  it('updates status to "scanning" when scan button is clicked', async () => {
    const user = userEvent.setup();
    render(<App />);
    const input = screen.getByRole('textbox');
    await user.type(input, '/home/user/project');
    const button = screen.getByRole('button', { name: /scan/i });
    await user.click(button);
    expect(screen.getByText(/scanning/i)).toBeInTheDocument();
  });

  it('has a status indicator element with a data-status attribute', () => {
    const { container } = render(<App />);
    const statusEl = container.querySelector('[data-status]');
    expect(statusEl).toBeTruthy();
    expect(statusEl!.getAttribute('data-status')).toBe('idle');
  });

  it('status indicator reflects "scanning" after clicking scan', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    const input = screen.getByRole('textbox');
    await user.type(input, '/home/user/project');
    const button = screen.getByRole('button', { name: /scan/i });
    await user.click(button);
    const statusEl = container.querySelector('[data-status]');
    expect(statusEl!.getAttribute('data-status')).toBe('scanning');
  });
});

// ---------------------------------------------------------------------------
// Behavior 4: Error State
// ---------------------------------------------------------------------------

describe('App: Error State', () => {
  it('does not show an error message when status is idle', () => {
    render(<App />);
    const errorEl = screen.queryByRole('alert');
    expect(errorEl).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Behavior 5: Scan Button Edge Cases
// ---------------------------------------------------------------------------

describe('App: Scan Button Edge Cases', () => {
  it('trims whitespace from path — button stays disabled for whitespace-only input', async () => {
    const user = userEvent.setup();
    render(<App />);
    const input = screen.getByRole('textbox');
    await user.type(input, '   ');
    const button = screen.getByRole('button', { name: /scan/i });
    expect(button).toBeDisabled();
  });

  it('disables scan button while status is scanning', async () => {
    const user = userEvent.setup();
    render(<App />);
    const input = screen.getByRole('textbox');
    await user.type(input, '/home/user/project');
    const button = screen.getByRole('button', { name: /scan/i });
    await user.click(button);
    expect(button).toBeDisabled();
  });
});
