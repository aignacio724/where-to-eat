import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

/**
 * Browser APIs jsdom does not implement, which the Radix/cmdk combobox reaches
 * for as soon as the suggestion popover opens. They only drive positioning and
 * scrolling, so no-ops are enough to let the components render under test.
 */
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

Element.prototype.scrollIntoView ??= function scrollIntoView() {};
Element.prototype.hasPointerCapture ??= function hasPointerCapture() {
  return false;
};
Element.prototype.releasePointerCapture ??= function releasePointerCapture() {};

// RTL's auto-cleanup only registers with a global afterEach; register it
// explicitly so a mounted component cannot leak into the next test.
afterEach(() => {
  cleanup();
});