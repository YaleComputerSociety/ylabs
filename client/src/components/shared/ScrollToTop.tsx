/**
 * Scroll-to-top button that appears on page scroll.
 */
import { useLayoutEffect } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

const scrollPositions = new Map<string, number>();

const ScrollToTop = () => {
  const { pathname } = useLocation();
  const navigationType = useNavigationType();

  useLayoutEffect(() => {
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
