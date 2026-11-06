import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Tooltip } from './Tooltip';

describe('Tooltip', () => {
  it('describes its trigger and opens on focus', () => {
    render(
      <Tooltip content="Finish the lesson first">
        <button type="button">Continue</button>
      </Tooltip>,
    );
    const btn = screen.getByRole('button', { name: 'Continue' });
    const tip = screen.getByRole('tooltip', { hidden: true });
    expect(btn.getAttribute('aria-describedby')).toBe(tip.id);
    fireEvent.focus(btn);
    expect(tip.className).toMatch(/open/);
  });

  it('closes on Escape', () => {
    render(
      <Tooltip content="Help">
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    fireEvent.focus(screen.getByRole('button'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('tooltip', { hidden: true }).className).not.toMatch(/open/);
  });

  it('visual mode is hidden from assistive tech', () => {
    render(
      <Tooltip content="Settings" mode="visual">
        <button type="button" aria-label="Settings" />
      </Tooltip>,
    );
    expect(screen.getByRole('button').getAttribute('aria-describedby')).toBeNull();
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
