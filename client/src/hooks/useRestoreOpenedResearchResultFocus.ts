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

const isLaidOutOutsideViewport = (element: HTMLElement): boolean => {
  const rect = element.getBoundingClientRect();
  if (rect.height === 0) return false;
  const viewport =
    document.querySelector<HTMLElement>('[data-scroll-container]')?.getBoundingClientRect() ??
    new DOMRect(0, 0, window.innerWidth, window.innerHeight);
  return rect.bottom <= viewport.top || rect.top >= viewport.bottom;
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
        link.focus({ preventScroll: !isLaidOutOutsideViewport(link) });
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
