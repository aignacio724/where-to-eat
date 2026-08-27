import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// RTL's auto-cleanup only registers with a global afterEach; register it
// explicitly so a mounted component cannot leak into the next test.
afterEach(() => {
  cleanup();
});