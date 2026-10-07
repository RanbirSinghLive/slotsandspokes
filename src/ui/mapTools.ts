/**
 * Tips for the map tools strip (index.html's #map-tools). Its buttons are
 * icons with the words in `data-tip`: the tip shows on hover or keyboard
 * focus, and on a touch screen, where nothing hovers, for a couple of
 * seconds after a tap, so a phone player can still read what they pressed.
 * The rail's buttons get the same tip, built from their label and title,
 * and so do the icon chips at the top of a long inspector view.
 * It reuses the ⓘ tooltip box (ui/infoTooltip.ts) and sits beside the
 * strip, on the side with room.
 */

const TOUCH_TIP_MS = 2200;

export function setupMapToolTips(): void {
  const strip = document.querySelector<HTMLElement>('#map-tools');
  const rail = document.querySelector<HTMLElement>('#rail');
  const inspectorBody = document.querySelector<HTMLElement>('#inspector-body');
  const tooltip = document.querySelector<HTMLDivElement>('#info-tooltip');
  if (!strip || !rail || !inspectorBody || !tooltip) return;
  for (const area of [strip, rail, inspectorBody]) wireTips(area, tooltip);
}

function wireTips(strip: HTMLElement, tooltip: HTMLDivElement): void {
  // The map tools sit low on a phone, so their tip goes above the whole strip; the rail's goes beside its button.
  const aboveWhenLow = strip.id === 'map-tools';
  let hideTimer = 0;

  const hide = (): void => {
    window.clearTimeout(hideTimer);
    tooltip.hidden = true;
  };

  const show = (button: HTMLElement): void => {
    const text = button.dataset.tip;
    if (!text) return;
    window.clearTimeout(hideTimer);
    tooltip.textContent = text;
    tooltip.hidden = false;
    tooltip.style.left = '0px'; // measure at full width, not squeezed by the edge
    tooltip.style.maxWidth = '';
    const rect = button.getBoundingClientRect();
    const box = tooltip.getBoundingClientRect();
    let left: number;
    let top: number;
    if (aboveWhenLow && rect.top > window.innerHeight / 2) {
      // The strip sits low (a phone): above all of it, so no button is covered.
      const stripBox = strip.getBoundingClientRect();
      tooltip.style.maxWidth = `${stripBox.width}px`;
      left = stripBox.left;
      top = stripBox.top - tooltip.getBoundingClientRect().height - 8;
    } else {
      // The strip sits high: beside the button, on the side with room.
      left = rect.left - box.width - 8 >= 8 ? rect.left - box.width - 8 : rect.right + 8;
      top = rect.top + rect.height / 2 - box.height / 2;
    }
    tooltip.style.left = `${Math.max(8, Math.min(left, window.innerWidth - box.width - 8))}px`;
    tooltip.style.top = `${Math.max(8, Math.min(top, window.innerHeight - box.height - 8))}px`;
  };

  // The rail's buttons carry a native title (it also changes with the panel); swap it for the instant tip.
  const buttonFrom = (target: EventTarget | null): HTMLElement | null => {
    const button = target instanceof Element ? target.closest<HTMLElement>('[data-tip], .rail-item[title]') : null;
    if (button && button.title) {
      button.dataset.tip = `${button.getAttribute('aria-label') ?? ''} · ${button.title}`;
      button.removeAttribute('title');
    }
    return button;
  };

  strip.addEventListener('mouseover', (event) => {
    const button = buttonFrom(event.target);
    if (button) show(button);
  });
  strip.addEventListener('mouseout', (event) => {
    if (buttonFrom(event.target)) hide();
  });
  strip.addEventListener('focusin', (event) => {
    const button = buttonFrom(event.target);
    if (button) show(button);
  });
  strip.addEventListener('focusout', hide);
  strip.addEventListener('click', (event) => {
    const button = buttonFrom(event.target);
    if (!button || !window.matchMedia('(pointer: coarse)').matches) return;
    show(button);
    hideTimer = window.setTimeout(hide, TOUCH_TIP_MS);
  });
}
