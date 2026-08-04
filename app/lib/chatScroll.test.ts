import { describe, expect, it } from 'vitest';
import { CHAT_SCROLL_THRESHOLD_PX, isNearBottom, shouldAutoScroll } from './chatScroll';

describe('chatScroll helpers', () => {
  it('treats content within the threshold as near the bottom', () => {
    const container = { scrollTop: 100, scrollHeight: 500, clientHeight: 352 };
    expect(isNearBottom(container)).toBe(true);
  });

  it('treats content farther than the threshold as not near the bottom', () => {
    const container = { scrollTop: 100, scrollHeight: 900, clientHeight: 350 };
    expect(isNearBottom(container)).toBe(false);
  });

  it('lets callers force scrolling even when not near bottom', () => {
    const container = { scrollTop: 0, scrollHeight: 900, clientHeight: 350 };
    expect(shouldAutoScroll(container, true)).toBe(true);
    expect(shouldAutoScroll(container, false)).toBe(false);
  });

  it('uses the configured threshold', () => {
    const container = { scrollTop: 100, scrollHeight: 500, clientHeight: 352 };
    expect(isNearBottom(container, CHAT_SCROLL_THRESHOLD_PX)).toBe(true);
    expect(isNearBottom(container, 10)).toBe(false);
  });
});
