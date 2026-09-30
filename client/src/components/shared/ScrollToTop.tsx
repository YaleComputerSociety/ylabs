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

const ScrollToTop = () => {
  const { pathname } = useLocation();
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
    const isRouteChange =
      previousPathname.current !== null && previousPathname.current !== pathname;
    previousPathname.current = pathname;
    const scrollContainer = document.querySelector<HTMLElement>('[data-scroll-container]');
    const savedScrollTop = scrollPositions.get(pathname);
    const saveScrollPosition = () => {
      scrollPositions.set(pathname, scrollContainer?.scrollTop ?? window.scrollY);
    };
    const restoreScrollPosition = () => {
      if (scrollContainer) {
        scrollContainer.scrollTop =
          navigationType === 'POP' && savedScrollTop !== undefined ? savedScrollTop : 0;
      }

      if (navigationType === 'POP' && savedScrollTop !== undefined) {
        window.scrollTo(0, savedScrollTop);
      } else {
        window.scrollTo(0, 0);
      }
    };

    restoreScrollPosition();
    if (isRouteChange && (navigationType !== 'POP' || nothingHoldsFocus())) {
      focusMainContent();
    }
    const animationFrame = window.requestAnimationFrame(restoreScrollPosition);

    if (scrollContainer) {
      scrollContainer.addEventListener('scroll', saveScrollPosition, { passive: true });
    } else {
      window.addEventListener('scroll', saveScrollPosition, { passive: true });
    }

    return () => {
      window.cancelAnimationFrame(animationFrame);
      saveScrollPosition();
      if (scrollContainer) {
        scrollContainer.removeEventListener('scroll', saveScrollPosition);
      } else {
        window.removeEventListener('scroll', saveScrollPosition);
      }
    };
  }, [navigationType, pathname]);

  return null;
};

export default ScrollToTop;
