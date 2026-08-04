export const CHAT_SCROLL_THRESHOLD_PX = 48;

export function getDistanceFromBottom(container: Pick<HTMLElement, 'scrollTop' | 'scrollHeight' | 'clientHeight'>): number {
  return container.scrollHeight - (container.scrollTop + container.clientHeight);
}

export function isNearBottom(
  container: Pick<HTMLElement, 'scrollTop' | 'scrollHeight' | 'clientHeight'>,
  threshold = CHAT_SCROLL_THRESHOLD_PX,
): boolean {
  return getDistanceFromBottom(container) <= threshold;
}

export function shouldAutoScroll(
  container: Pick<HTMLElement, 'scrollTop' | 'scrollHeight' | 'clientHeight'>,
  force = false,
  threshold = CHAT_SCROLL_THRESHOLD_PX,
): boolean {
  return force || isNearBottom(container, threshold);
}
