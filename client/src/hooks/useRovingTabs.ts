import { useRef, useState, type KeyboardEvent } from 'react';

const nextIndexForKey = (key: string, currentIndex: number, count: number): number | null => {
  switch (key) {
    case 'ArrowRight':
      return (currentIndex + 1) % count;
    case 'ArrowLeft':
      return (currentIndex - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
};

const useRovingTabs = <T extends string>(tabs: readonly T[], initialTab: T) => {
  const [activeTab, setActiveTab] = useState<T>(initialTab);
  const tabElements = useRef(new Map<T, HTMLButtonElement>());

  const activateTab = (next: T, focusTab = false) => {
    setActiveTab(next);
    if (focusTab) tabElements.current.get(next)?.focus();
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const nextIndex = nextIndexForKey(event.key, tabs.indexOf(activeTab), tabs.length);
    if (nextIndex === null) return;
    event.preventDefault();
    activateTab(tabs[nextIndex], true);
  };

  const registerTab = (tab: T) => (element: HTMLButtonElement | null) => {
    if (element) tabElements.current.set(tab, element);
    else tabElements.current.delete(tab);
  };

  return { activeTab, activateTab, handleTabKeyDown, registerTab };
};

export default useRovingTabs;
