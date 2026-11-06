import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';
import { ThemeProvider } from './design/theme/ThemeProvider';

describe('App shell', () => {
  it('renders the CSense heading', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: 'CSense' })).toBeDefined();
  });

  it('renders inside the ThemeProvider with the dark theme applied', () => {
    render(
      <ThemeProvider>
        <App />
      </ThemeProvider>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'CSense' })).toBeDefined();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
