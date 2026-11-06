import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../test/axe';
import { formatTime, VideoPlayerFrame } from './VideoPlayerFrame';

describe('VideoPlayerFrame', () => {
  it('formats time as m:ss', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(192.4)).toBe('3:12');
  });

  it('renders a keyboard-focusable player with labelled controls and captions track', () => {
    const { container } = render(
      <VideoPlayerFrame
        title="Phishing"
        src="/video.mp4"
        captionsSrc="/captions.vtt"
        onToggleTranscript={() => undefined}
      />,
    );
    expect(screen.getByRole('group', { name: /Video: Phishing/ }).getAttribute('tabindex')).toBe(
      '0',
    );
    expect(screen.getByRole('button', { name: 'Play' })).toBeDefined();
    expect(screen.getByRole('slider', { name: 'Seek' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Hide captions' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(container.querySelector('track[kind="captions"]')).not.toBeNull();
  });

  it('disables the captions control when none are available', () => {
    render(<VideoPlayerFrame title="X" src="/v.mp4" />);
    expect(screen.getByRole('button', { name: 'No captions available' })).toHaveProperty(
      'disabled',
      true,
    );
  });

  it('toggles the transcript via the seam', () => {
    const onToggle = vi.fn();
    render(<VideoPlayerFrame title="X" src="/v.mp4" onToggleTranscript={onToggle} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show transcript' }));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('shows error and empty states', () => {
    const { rerender } = render(<VideoPlayerFrame title="X" state="error" />);
    expect(screen.getByText('Video unavailable')).toBeDefined();
    rerender(<VideoPlayerFrame title="X" state="empty" />);
    expect(screen.getByText('No video for this lesson')).toBeDefined();
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <VideoPlayerFrame title="Phishing" src="/v.mp4" captionsSrc="/c.vtt" />,
    );
    await expectNoA11yViolations(container);
  });
});
