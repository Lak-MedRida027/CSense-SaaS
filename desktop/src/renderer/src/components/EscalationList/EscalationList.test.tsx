import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../test/axe';
import { EscalationList } from './EscalationList';

const items = [
  {
    id: 'x1',
    severity: 'critical' as const,
    title: 'Credential submitted in simulation',
    employeeName: 'Karim Diaz',
    occurredAtText: 'Today 10:42',
    status: 'open' as const,
  },
];

describe('EscalationList', () => {
  it('labels severity in text and wires review', () => {
    const onReview = vi.fn();
    render(<EscalationList title="Escalations" items={items} onReview={onReview} />);
    expect(screen.getByText('Critical:')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /Review: Credential submitted/ }));
    expect(onReview).toHaveBeenCalledWith('x1');
  });

  it('shows an empty state', () => {
    render(<EscalationList title="Escalations" items={[]} />);
    expect(screen.getByText('No open escalations')).toBeDefined();
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <EscalationList title="Escalations" items={items} onReview={() => undefined} />,
    );
    await expectNoA11yViolations(container);
  });
});
