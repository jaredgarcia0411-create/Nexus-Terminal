import React from 'react';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

afterEach(() => {
  if (typeof document !== 'undefined') {
    cleanup();
  }
});
