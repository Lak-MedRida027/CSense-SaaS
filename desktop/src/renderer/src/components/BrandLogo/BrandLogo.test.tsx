import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ThemeProvider } from '../../design/theme/ThemeProvider';
import { BrandLogo } from './BrandLogo';

describe('BrandLogo', () => {
  it('uses the app name as alt text by default', () => {
    render(
      <ThemeProvider>
        <BrandLogo />
      </ThemeProvider>,
    );
    expect(screen.getByRole('img', { name: 'CSense' })).toBeDefined();
  });

  it('uses the client app name and theme-specific asset', () => {
    render(
      <ThemeProvider
        initialPreferences={{ theme: 'light' }}
        brand={{
          appName: 'Acme Aware',
          logoMark: { dark: '/mark-dark.svg', light: '/mark-light.svg' },
        }}
      >
        <BrandLogo variant="mark" />
      </ThemeProvider>,
    );
    const img = screen.getByRole('img', { name: 'Acme Aware' });
    expect(img.getAttribute('src')).toBe('/mark-light.svg');
  });

  it('can be decorative', () => {
    render(
      <ThemeProvider>
        <BrandLogo decorative />
      </ThemeProvider>,
    );
    expect(screen.queryByRole('img', { name: 'CSense' })).toBeNull();
  });
});
