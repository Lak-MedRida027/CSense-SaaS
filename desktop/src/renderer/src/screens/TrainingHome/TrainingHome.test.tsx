import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../../design/theme/ThemeProvider';
import { expectNoA11yViolations } from '../../test/axe';
import { TrainingHomeScreen } from './TrainingHome';
import {
  trainingHomeAdminFixture,
  trainingHomeErrorFixture,
  trainingHomeFixture,
  trainingHomeOfflineFixture,
} from './TrainingHome.fixtures';

const view = (ui: ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

describe('TrainingHomeScreen', () => {
  it('lists modules with their status, the unlock rule and the final assessment', () => {
    view(<TrainingHomeScreen {...trainingHomeFixture} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Your training' })).toBeDefined();
    expect(screen.getByText(/Spotting phishing/)).toBeDefined();
    expect(screen.getByText(/Pass the Module 2 quiz first/)).toBeDefined();
    expect(screen.getByText('Pass 5 more modules to unlock.')).toBeDefined();
    expect(screen.queryByRole('button', { name: /final assessment/i })).toBeNull();
  });

  it('only modules with an available quiz get a Start quiz button', () => {
    const onStartQuiz = vi.fn();
    view(<TrainingHomeScreen {...trainingHomeFixture} onStartQuiz={onStartQuiz} />);
    const buttons = screen.getAllByRole('button', { name: /Start quiz/ });
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0] as HTMLElement);
    expect(onStartQuiz).toHaveBeenCalledWith('m2');
  });

  it('offline notice, error with retry, and admin placeholder', () => {
    const onRetry = vi.fn();
    const { rerender } = view(<TrainingHomeScreen {...trainingHomeOfflineFixture} />);
    expect(screen.getByText(/working offline/)).toBeDefined();
    rerender(
      <ThemeProvider>
        <TrainingHomeScreen {...trainingHomeErrorFixture} onRetry={onRetry} />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(onRetry).toHaveBeenCalled();
    rerender(
      <ThemeProvider>
        <TrainingHomeScreen {...trainingHomeAdminFixture} />
      </ThemeProvider>,
    );
    expect(screen.getByText('Admin console arrives in a later release')).toBeDefined();
    expect(screen.queryByText('Modules')).toBeNull();
  });

  it.each([
    ['default', trainingHomeFixture],
    ['offline', trainingHomeOfflineFixture],
    ['error', trainingHomeErrorFixture],
    ['admin', trainingHomeAdminFixture],
  ])('has no axe violations (%s)', async (_n, props) => {
    const { container } = view(<TrainingHomeScreen {...props} />);
    await expectNoA11yViolations(container);
  });
});
