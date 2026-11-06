import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from './ThemeProvider';
import { useTheme } from './useTheme';

function Probe() {
  const { resolvedTheme, reducedMotion, setPreferences } = useTheme();
  return (
    <div>
      <span data-testid="theme">{resolvedTheme}</span>
      <span data-testid="motion">{String(reducedMotion)}</span>
      <button
        type="button"
        onClick={() => {
          setPreferences({ theme: 'light', motion: 'reduced' });
        }}
      >
        switch
      </button>
    </div>
  );
}

describe('ThemeProvider', () => {
  it('defaults to dark and writes data attributes on <html>', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('theme').textContent).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.dataset.motion).toBe('system');
  });

  it('switches theme and motion and reports the change', () => {
    const onChange = vi.fn();
    render(
      <ThemeProvider onPreferencesChange={onChange}>
        <Probe />
      </ThemeProvider>,
    );
    act(() => {
      screen.getByRole('button', { name: 'switch' }).click();
    });
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.dataset.motion).toBe('reduced');
    expect(screen.getByTestId('motion').textContent).toBe('true');
    expect(onChange).toHaveBeenCalledWith({
      theme: 'light',
      motion: 'reduced',
      textSize: 'default',
    });
  });

  it('applies a valid client primary as CSS variables', () => {
    render(
      <ThemeProvider brand={{ appName: 'Acme', colors: { primary: '#7B3FA0' } }}>
        <Probe />
      </ThemeProvider>,
    );
    expect(document.documentElement.style.getPropertyValue('--cs-color-brand-primary')).not.toBe(
      '',
    );
    expect(document.title).toBe('Acme');
  });

  it('does not apply a primary that collides with a status hue', () => {
    render(
      <ThemeProvider brand={{ appName: 'Acme', colors: { primary: '#DC2626' } }}>
        <Probe />
      </ThemeProvider>,
    );
    expect(document.documentElement.style.getPropertyValue('--cs-color-brand-primary')).toBe('');
    expect(document.documentElement.style.getPropertyValue('--cs-color-brand-accent')).toBe(
      '#DC2626',
    );
  });
});
