import { KeyboardEvent, useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type InertedElement = { element: HTMLElement; inert: boolean; ariaHidden: string | null };

const inertEverythingOutside = (root: HTMLElement): InertedElement[] => {
  const inerted: InertedElement[] = [];
  let branch: HTMLElement | null = root;

  while (branch?.parentElement) {
    Array.from(branch.parentElement.children).forEach((sibling) => {
      if (sibling === branch || !(sibling instanceof HTMLElement)) return;
      inerted.push({
        element: sibling,
        inert: sibling.inert,
        ariaHidden: sibling.getAttribute('aria-hidden'),
      });
      sibling.inert = true;
      sibling.setAttribute('aria-hidden', 'true');
    });
    branch = branch.parentElement;
    if (branch === document.body) break;
  }

  return inerted;
};

const restoreInerted = (inerted: InertedElement[]) => {
  inerted.forEach(({ element, inert, ariaHidden }) => {
    element.inert = inert;
    if (ariaHidden === null) element.removeAttribute('aria-hidden');
    else element.setAttribute('aria-hidden', ariaHidden);
  });
};

const focusableWithin = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true',
  );

export default function useModalDialog<InitialFocus extends HTMLElement = HTMLElement>(
  isOpen: boolean,
  onClose: () => void,
) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const initialFocusRef = useRef<InitialFocus>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return undefined;

    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const returnFocusTo = document.activeElement as HTMLElement | null;
    const inertRoot = overlayRef.current ?? dialogRef.current;
    const inerted = inertRoot ? inertEverythingOutside(inertRoot) : [];

    initialFocusRef.current?.focus();

    return () => {
      restoreInerted(inerted);
      returnFocusTo?.focus();
    };
  }, [isOpen]);

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab' || !dialogRef.current) return;

    const focusable = focusableWithin(dialogRef.current);
    if (focusable.length === 0) {
      event.preventDefault();
      initialFocusRef.current?.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement as HTMLElement | null;
    const onUntabbableStart =
      active !== null && active === initialFocusRef.current && !focusable.includes(active);
    if (event.shiftKey && (active === first || onUntabbableStart)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return { overlayRef, dialogRef, initialFocusRef, handleDialogKeyDown };
}
