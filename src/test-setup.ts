import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// Expose vi as jest global for @testing-library/dom's waitFor fake-timer detection
// RTL checks for `jest.advanceTimersByTime` to handle fake timers in waitFor loops
(globalThis as any).jest = {
  ...vi,
  advanceTimersByTime: vi.advanceTimersByTime.bind(vi),
};
