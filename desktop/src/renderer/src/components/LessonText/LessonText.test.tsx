import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../test/axe';
import { LessonText, splitParagraphs } from './LessonText';

describe('LessonText', () => {
  it('splits on blank lines and drops empty paragraphs', () => {
    expect(splitParagraphs('One.\n\nTwo.\r\n\r\n\n  \nThree\nstill three')).toEqual([
      'One.',
      'Two.',
      'Three\nstill three',
    ]);
    expect(splitParagraphs('   ')).toEqual([]);
  });

  it('TXT1: markup in authored text renders as literal text, never as elements', () => {
    const { container } = render(
      <LessonText text={'<img src=x onerror="alert(1)">\n\n<script>boom()</script> <b>bold</b>'} />,
    );
    expect(container.querySelector('img, script, b')).toBeNull();
    expect(screen.getByText(/<img src=x onerror/)).toBeDefined();
    expect(screen.getByText(/<script>boom\(\)<\/script> <b>bold<\/b>/)).toBeDefined();
  });

  it('renders nothing for empty text and has no a11y violations', async () => {
    const { container, rerender } = render(<LessonText text="" />);
    expect(container.firstChild).toBeNull();
    rerender(<LessonText text={'First paragraph.\n\nSecond paragraph.'} />);
    expect(screen.getAllByText(/paragraph/)).toHaveLength(2);
    await expectNoA11yViolations(container);
  });
});
