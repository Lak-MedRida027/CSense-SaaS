import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../test/axe';
import { Tabs } from './Tabs';

const items = [
  { id: 'a', label: 'Overview', content: <p>Overview panel</p> },
  { id: 'b', label: 'Employees', content: <p>Employees panel</p> },
  { id: 'c', label: 'Reports', content: <p>Reports panel</p> },
];

describe('Tabs', () => {
  it('uses roving tabindex and arrow-key activation', () => {
    const onSelect = vi.fn();
    render(<Tabs label="Sections" items={items} onSelect={onSelect} />);
    const [a, b, c] = screen.getAllByRole('tab');
    expect(a?.getAttribute('tabindex')).toBe('0');
    expect(b?.getAttribute('tabindex')).toBe('-1');
    fireEvent.keyDown(a as HTMLElement, { key: 'ArrowRight' });
    expect(onSelect).toHaveBeenLastCalledWith('b');
    expect(screen.getByText('Employees panel')).toBeDefined();
    fireEvent.keyDown(b as HTMLElement, { key: 'End' });
    expect(onSelect).toHaveBeenLastCalledWith('c');
    fireEvent.keyDown(c as HTMLElement, { key: 'ArrowRight' });
    expect(onSelect).toHaveBeenLastCalledWith('a');
  });

  it('has no axe violations', async () => {
    const { container } = render(<Tabs label="Sections" items={items} />);
    await expectNoA11yViolations(container);
  });
});
