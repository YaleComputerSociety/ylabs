import { useLayoutEffect, useState, type RefObject } from 'react';

export type PopoverSide = 'below' | 'above';

export interface ViewportFitPlacement {
  side: PopoverSide;
  maxHeight: number | undefined;
}

const VIEWPORT_MARGIN_PX = 8;
const ANCHOR_GAP_PX = 4;
const COMFORTABLE_HEIGHT_PX = 360;

interface VerticalBounds {
  top: number;
  bottom: number;
}

export const placeAgainstViewport = (
  anchor: VerticalBounds,
  visible: VerticalBounds,
): ViewportFitPlacement => {
  const spaceBelow = visible.bottom - anchor.bottom - ANCHOR_GAP_PX - VIEWPORT_MARGIN_PX;
  const spaceAbove = anchor.top - visible.top - ANCHOR_GAP_PX - VIEWPORT_MARGIN_PX;
  const side: PopoverSide =
    spaceBelow >= COMFORTABLE_HEIGHT_PX || spaceBelow >= spaceAbove ? 'below' : 'above';
  const space = side === 'below' ? spaceBelow : spaceAbove;
  return { side, maxHeight: Math.max(0, Math.floor(space)) };
};

const visibleBoundsAround = (anchor: HTMLElement): VerticalBounds => {
  const scroller = anchor.closest('[data-scroll-container]')?.getBoundingClientRect();
  return {
    top: Math.max(0, scroller?.top ?? 0),
    bottom: Math.min(window.innerHeight, scroller?.bottom ?? window.innerHeight),
  };
};

const UNCONSTRAINED: ViewportFitPlacement = { side: 'below', maxHeight: undefined };

const useViewportFitPlacement = (
  anchorRef: RefObject<HTMLElement | null>,
  isOpen: boolean,
  enabled: boolean,
): ViewportFitPlacement => {
  const [placement, setPlacement] = useState<ViewportFitPlacement>(UNCONSTRAINED);

  useLayoutEffect(() => {
    if (!isOpen || !enabled) return;
    const measure = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const next = placeAgainstViewport(
        anchor.getBoundingClientRect(),
        visibleBoundsAround(anchor),
      );
      setPlacement((previous) =>
        previous.side === next.side && previous.maxHeight === next.maxHeight ? previous : next,
      );
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [anchorRef, isOpen, enabled]);

  return isOpen && enabled ? placement : UNCONSTRAINED;
};

export default useViewportFitPlacement;
