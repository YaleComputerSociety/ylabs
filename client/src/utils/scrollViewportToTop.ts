import { scrollBehavior } from './scrollBehavior';

export const scrollViewportToTop = () => {
  const scrollContainer = document.querySelector<HTMLElement>('[data-scroll-container]');
  if (scrollContainer) {
    scrollContainer.scrollTo({ top: 0, behavior: scrollBehavior() });
    return;
  }

  window.scrollTo({ top: 0, behavior: scrollBehavior() });
};
