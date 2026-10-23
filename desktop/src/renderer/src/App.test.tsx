import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './App';

afterEach(cleanup);

describe('App shell', () => {
  it('renders the CSense heading', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: 'CSense' })).toBeDefined();
  });
});
