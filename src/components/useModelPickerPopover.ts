import { useLayoutEffect, type RefObject } from 'react';

export function useModelPickerPopover(open: boolean, popupRef: RefObject<HTMLDivElement>, triggerRef: RefObject<HTMLButtonElement>) {
  // The top layer escapes scroll containers without moving the menu out of its
  // dialog, theme ancestry or focus trap. Keep it anchored inside the viewport.
  useLayoutEffect(() => {
    if (!open) return;
    const popup = popupRef.current;
    const trigger = triggerRef.current;
    if (!popup || !trigger) return;
    popup.setAttribute('popover', 'manual');
    popup.showPopover();
    const position = () => {
      const rect = trigger.getBoundingClientRect();
      const margin = 8;
      const gap = 5;
      const below = Math.max(0, window.innerHeight - rect.bottom - gap - margin);
      const above = Math.max(0, rect.top - gap - margin);
      const upwards = below < 230 && above > below;
      popup.style.width = `${Math.min(Math.max(rect.width, 240), window.innerWidth - margin * 2)}px`;
      popup.style.maxHeight = `${Math.min(230, upwards ? above : below)}px`;
      const box = popup.getBoundingClientRect();
      popup.style.left = `${Math.max(margin, Math.min(rect.left, window.innerWidth - box.width - margin))}px`;
      popup.style.top = `${Math.max(margin, upwards ? rect.top - gap - box.height : rect.bottom + gap)}px`;
    };
    position();
    popup.querySelector('input')?.focus({ preventScroll: true });
    const observer = new ResizeObserver(position);
    observer.observe(popup);
    observer.observe(trigger);
    const onScroll = (event: Event) => {
      if (!popup.contains(event.target as Node)) position();
    };
    window.addEventListener('resize', position);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', position);
      document.removeEventListener('scroll', onScroll, true);
      observer.disconnect();
      if (popup.matches(':popover-open')) popup.hidePopover();
    };
  }, [open]);
}
