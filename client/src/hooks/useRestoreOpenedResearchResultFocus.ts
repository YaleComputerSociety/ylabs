import { useEffect } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
import {
  RESEARCH_RESULT_LINK_ATTRIBUTE,
  openedResearchResultFor,
} from '../utils/researchResultsReturn';

const RESTORE_WAIT_MS = 3000;
const USER_INTENT_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

const findResultLink = (slug: string): HTMLElement | undefined =>
  Array.from(document.querySelectorAll<HTMLElement>(`[${RESEARCH_RESULT_LINK_ATTRIBUTE}]`)).find(
    (link) => link.getAttribute(RESEARCH_RESULT_LINK_ATTRIBUTE) === slug,
  );

const scrollContainer = (): HTMLElement | null =>
  document.querySelector<HTMLElement>('[data-scroll-container]');

const scrollPaddingTop = (container: HTMLElement): number =>
  Number.parseFloat(getComputedStyle(container).scrollPaddingTop) || 0;

const bringFullyIntoView = (element: HTMLElement): void => {
  const container = scrollContainer();
  const rect = element.getBoundingClientRect();
  if (!container || rect.height === 0) return;
  const bounds = container.getBoundingClientRect();
  const visibleTop = bounds.top + scrollPaddingTop(container);
  const visibleHeight = bounds.bottom - visibleTop;
  if (rect.top >= visibleTop && rect.bottom <= bounds.bottom) return;
  const centredTop =
    rect.height >= visibleHeight ? visibleTop : visibleTop + (visibleHeight - rect.height) / 2;
  container.scrollTop += rect.top - centredTop;
};

export const useRestoreOpenedResearchResultFocus = (): void => {
  const { key: historyEntryKey } = useLocation();
  const navigationType = useNavigationType();

  useEffect(() => {
    if (navigationType !== 'POP') return;
    const slug = openedResearchResultFor(historyEntryKey);
    if (!slug) return;

    const deadline = performance.now() + RESTORE_WAIT_MS;
    let animationFrame: number | null = null;
    const stop = () => {
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
      animationFrame = null;
      USER_INTENT_EVENTS.forEach((type) => window.removeEventListener(type, stop, true));
    };
    const focusOpenedResult = () => {
      const link = findResultLink(slug);
      if (link) {
        stop();
        link.focus({ preventScroll: true });
        bringFullyIntoView(link.closest('article') ?? link);
        return;
      }
      if (performance.now() > deadline) {
        stop();
        return;
      }
      animationFrame = window.requestAnimationFrame(focusOpenedResult);
    };

    USER_INTENT_EVENTS.forEach((type) =>
      window.addEventListener(type, stop, { capture: true, passive: true }),
    );
    animationFrame = window.requestAnimationFrame(focusOpenedResult);
    return stop;
  }, [historyEntryKey, navigationType]);
};
