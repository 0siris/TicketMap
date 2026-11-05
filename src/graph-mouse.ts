import type { Core } from 'cytoscape';

export function installMousePanning(element: HTMLElement, cy: Core): () => void {
  let drag: { pointerId: number; x: number; y: number; pan: { x: number; y: number } } | null = null;
  const previousCursor = element.style.cursor;
  const stop = () => {
    if (drag && element.hasPointerCapture(drag.pointerId)) element.releasePointerCapture(drag.pointerId);
    drag = null; element.style.cursor = previousCursor; cy.userPanningEnabled(true);
  };
  const down = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') { cy.userPanningEnabled(true); return; }
    // Mouse navigation uses the right button; touch keeps Cytoscape's native pan and pinch.
    cy.userPanningEnabled(false);
    if (event.button !== 2) return;
    drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, pan: { ...cy.pan() } };
    element.setPointerCapture(event.pointerId); element.style.cursor = 'grabbing';
    event.preventDefault(); event.stopImmediatePropagation();
  };
  const move = (event: PointerEvent) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!(event.buttons & 2)) { stop(); return; }
    cy.pan({ x: drag.pan.x + event.clientX - drag.x, y: drag.pan.y + event.clientY - drag.y });
    event.preventDefault(); event.stopImmediatePropagation();
  };
  const up = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return;
    if (drag) { event.preventDefault(); event.stopImmediatePropagation(); }
    stop();
  };
  const blockRightButton = (event: MouseEvent) => {
    if (event.button === 2) { event.preventDefault(); event.stopImmediatePropagation(); }
  };
  const contextMenu = (event: MouseEvent) => event.preventDefault();
  element.addEventListener('pointerdown', down, true);
  element.addEventListener('mousedown', blockRightButton, true);
  element.addEventListener('mouseup', blockRightButton, true);
  element.addEventListener('contextmenu', contextMenu);
  window.addEventListener('pointermove', move, true);
  window.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', up, true);
  window.addEventListener('blur', stop);
  return () => {
    stop();
    element.removeEventListener('pointerdown', down, true);
    element.removeEventListener('mousedown', blockRightButton, true);
    element.removeEventListener('mouseup', blockRightButton, true);
    element.removeEventListener('contextmenu', contextMenu);
    window.removeEventListener('pointermove', move, true);
    window.removeEventListener('pointerup', up, true);
    window.removeEventListener('pointercancel', up, true);
    window.removeEventListener('blur', stop);
  };
}

export function installWheelNormalization(element: HTMLElement): () => void {
  const wheel = (event: WheelEvent) => {
    if (event.defaultPrevented || event.deltaMode !== WheelEvent.DOM_DELTA_LINE) return;
    // Cytoscape's line-mode multiplier bypasses coarse-wheel normalization for small line deltas.
    event.preventDefault(); event.stopImmediatePropagation();
    event.target?.dispatchEvent(new WheelEvent('wheel', {
      bubbles: event.bubbles, cancelable: event.cancelable, composed: event.composed,
      clientX: event.clientX, clientY: event.clientY, screenX: event.screenX, screenY: event.screenY,
      ctrlKey: event.ctrlKey, shiftKey: event.shiftKey, altKey: event.altKey, metaKey: event.metaKey,
      deltaMode: WheelEvent.DOM_DELTA_PIXEL, deltaX: event.deltaX * 16, deltaY: event.deltaY * 16,
      deltaZ: event.deltaZ * 16,
    }));
  };
  element.addEventListener('wheel', wheel, { capture: true, passive: false });
  return () => element.removeEventListener('wheel', wheel, true);
}
