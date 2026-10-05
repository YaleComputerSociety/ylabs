/**
 * Scroll-to-top button that appears on page scroll.
 */
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

const scrollPositions = new Map<string, number>();

const nothingHoldsFocus = () =>
  document.activeElement === null || document.activeElement === document.body;

const focusMainContent = () => {
  document.getElementById('main-content')?.focus({ preventScroll: true });
};

const PAGE_SCROLL_KEYS = new Set([
  'PageDown',
  'PageUp',
  'ArrowDown',
  'ArrowUp',
  'Home',
  'End',
  ' ',
]);

const isPageScrollKey = (event: KeyboardEvent) =>
  PAGE_SCROLL_KEYS.has(event.key) && !event.altKey && !event.ctrlKey && !event.metaKey;

const focusMainContentBeforeUnfocusedScroll = (event: KeyboardEvent) => {
  if (event.defaultPrevented || !isPageScrollKey(event) || !nothingHoldsFocus()) return;
  focusMainContent();
};

const browserHistoryEntryKey = () => (window.history.state as { key?: unknown } | null)?.key;

const RESTORE_WAIT_MS = 3000;
const RESTORE_TOLERANCE_PX = 2;
const USER_SCROLL_INTENT_EVENTS = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;

const ScrollToTop = () => {
  const { key: historyEntryKey, pathname } = useLocation();
  const navigationType = useNavigationType();
  const previousPathname = useRef<string | null>(null);

  useEffect(() => {
    const stopBridgingUnfocusedScroll = () => {
      document.removeEventListener('keydown', focusMainContentBeforeUnfocusedScroll);
      document.removeEventListener('pointerdown', stopBridgingUnfocusedScroll, true);
    };
    document.addEventListener('keydown', focusMainContentBeforeUnfocusedScroll);
    document.addEventListener('pointerdown', stopBridgingUnfocusedScroll, true);
    return stopBridgingUnfocusedScroll;
  }, []);

  useLayoutEffect(() => {
    const isFirstRender = previousPathname.current === null;
    const isRouteChange = !isFirstRender && previousPathname.current !== pathname;
    previousPathname.current = pathname;
    const scrollContainer = document.querySelector<HTMLElement>('[data-scroll-container]');
    const savedScrollTop = scrollPositions.get(historyEntryKey);
    const isReturnToSavedEntry = navigationType === 'POP' && savedScrollTop !== undefined;
    const targetScrollTop = isReturnToSavedEntry
      ? savedScrollTop
      : isFirstRender || isRouteChange
        ? 0
        : null;
    const currentScrollTop = () => scrollContainer?.scrollTop ?? window.scrollY;
    // React Router commits a navigation in a transition, after window.history has
    // already moved, so a scroll-to-top issued with the navigation would otherwise
    // be recorded against the entry the student is leaving.
    const saveScrollPosition = () => {
      const activeEntryKey = browserHistoryEntryKey();
      scrollPositions.set(
        typeof activeEntryKey === 'string' ? activeEntryKey : historyEntryKey,
        currentScrollTop(),
      );
    };
    const applyTargetScrollTop = () => {
      if (targetScrollTop === null) return;
      if (scrollContainer) scrollContainer.scrollTop = targetScrollTop;
      window.scrollTo(0, targetScrollTop);
    };
    const hasReachedTarget = () =>
      targetScrollTop === null ||
      Math.abs(currentScrollTop() - targetScrollTop) <= RESTORE_TOLERANCE_PX;

    applyTargetScrollTop();
    if (isRouteChange && (navigationType !== 'POP' || nothingHoldsFocus())) {
      focusMainContent();
    }

    const restoreDeadline = performance.now() + RESTORE_WAIT_MS;
    let animationFrame: number | null = null;
    const stopRestoring = () => {
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
      animationFrame = null;
      USER_SCROLL_INTENT_EVENTS.forEach((type) =>
        window.removeEventListener(type, stopRestoring, true),
      );
    };
    const keepRestoringUntilContentFits = () => {
      applyTargetScrollTop();
      if (hasReachedTarget() || performance.now() > restoreDeadline) {
        stopRestoring();
        return;
      }
      animationFrame = window.requestAnimationFrame(keepRestoringUntilContentFits);
    };
    if (targetScrollTop !== null) {
      USER_SCROLL_INTENT_EVENTS.forEach((type) =>
        window.addEventListener(type, stopRestoring, { capture: true, passive: true }),
      );
      animationFrame = window.requestAnimationFrame(keepRestoringUntilContentFits);
    } else {
      saveScrollPosition();
    }

    const scrollTarget: HTMLElement | Window = scrollContainer ?? window;
    scrollTarget.addEventListener('scroll', saveScrollPosition, { passive: true });

    return () => {
      stopRestoring();
      scrollTarget.removeEventListener('scroll', saveScrollPosition);
    };
  }, [historyEntryKey, navigationType, pathname]);

  return null;
};

export default ScrollToTop;
