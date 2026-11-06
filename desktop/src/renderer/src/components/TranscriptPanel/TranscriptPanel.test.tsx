import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../test/axe';
import { TranscriptPanel } from './TranscriptPanel';

const cues = [
  { id: 'a', startSeconds: 0, text: 'Intro' },
  { id: 'b', startSeconds: 75, text: 'Check the sender' },
];

describe('TranscriptPanel', () => {
  it('lets users jump to a cue and marks the active one', () => {
    const onSeek = vi.fn();
    render(<TranscriptPanel cues={cues} activeCueId="b" onSeek={onSeek} />);
    fireEvent.click(screen.getByRole('button', { name: 'Jump to 1:15' }));
    expect(onSeek).toHaveBeenCalledWith(75);
    expect(screen.getByText('Check the sender').closest('li')?.getAttribute('aria-current')).toBe(
      'true',
    );
  });

  it('has a focusable scroll region and no axe violations', async () => {
    const { container } = render(<TranscriptPanel cues={cues} />);
    expect(screen.getByRole('region', { name: 'Transcript' }).getAttribute('tabindex')).toBe('0');
    await expectNoA11yViolations(container);
  });
});
