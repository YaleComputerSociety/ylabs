/**
 * Shared modal behavior: Escape-to-close, body-scroll lock with scrollbar
 * compensation, focus trap, and focus restoration on close.
 */
import { useEffect, useRef, RefObject } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export const useModalBehavior = (
  isOpen: boolean,
  onClose: () => void,
  containerRef: RefObject<HTMLElement | null>,
) => {
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;

    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    const prevOverflow = document.body.style.overflow;
    const prevPaddingRight = document.body.style.paddingRight;
    document.body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }

    const rafId = window.requestAnimationFrame(() => {
      const node = containerRef.current;
      if (!node) return;
      const focusables = node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusables.length > 0) {
        focusables[0].focus();
      } else if (typeof (node as HTMLElement).focus === 'function') {
        (node as HTMLElement).focus();
      }
    });

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const node = containerRef.current;
      if (!node) return;
      const focusables = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        .filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
      if (focusables.length === 0) {
        e.preventDefault();
        if (typeof (node as HTMLElement).focus === 'function') (node as HTMLElement).focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || !node.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleKey);

    return () => {
      window.cancelAnimationFrame(rafId);
      document.body.style.overflow = prevOverflow;
      document.body.style.paddingRight = prevPaddingRight;
      window.removeEventListener('keydown', handleKey);
      const toRestore = previouslyFocusedRef.current;
      if (toRestore && typeof toRestore.focus === 'function') {
        toRestore.focus();
      }
      previouslyFocusedRef.current = null;
    };
  }, [isOpen, onClose, containerRef]);
};

export default useModalBehavior;
