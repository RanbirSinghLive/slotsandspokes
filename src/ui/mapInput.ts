/**
 * Touch input for the map: one state machine from raw pointer events to the
 * few things the player can mean. main.ts says what each of them does.
 *
 *   idle ──finger down──▶ pressed ──moves past the slop──▶ panning
 *                            │  ▲                              │
 *                 second finger  └── back to one finger ◀── (any finger lifts)
 *                            ▼
 *                         pinching
 *
 * A press that ends while still `pressed` is a tap (or the second half of a
 * double tap). Mouse input stays on main.ts's own handlers.
 */

type Phase = 'idle' | 'pressed' | 'panning' | 'pinching';

export type MapInputHandlers = {
  /** A first finger went down at map pixel (x, y): where a press-and-hold may start. */
  pressed(x: number, y: number): void;
  /** Anything waiting on the finger staying still (a press-and-hold) stops. */
  cancelHold(): void;
  /** The press became a pan or pinch: close what a drag would leave hanging. */
  gestureStarted(): void;
  /** A held press already did its own thing, so its release is not also a tap. */
  holdFired(): boolean;
  /** One finger moved the map by (dx, dy) map pixels. */
  pan(dx: number, dy: number): void;
  /** Two fingers: slide by (dx, dy), then zoom by `ratio` about map pixel (x, y). */
  pinch(x: number, y: number, ratio: number, dx: number, dy: number): void;
  /** The gesture is over (last finger up): sharpen what a pinch scaled. */
  gestureEnded(): void;
  /** A tap, at page (client) coordinates. */
  tap(clientX: number, clientY: number): void;
  /** A second tap close to the first, at map pixel (x, y). */
  doubleTap(x: number, y: number): void;
};

/** A finger wobbles more than a mouse, so a touch pans only after moving this far. */
const PAN_SLOP_PX = 8;
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_SLOP_PX = 30;

export function setupMapInput(canvas: HTMLCanvasElement, toMapPoint: (clientX: number, clientY: number) => [number, number], handlers: MapInputHandlers): void {
  const fingers = new Map<number, [number, number]>();
  let phase: Phase = 'idle';
  let pressOrigin: [number, number] = [0, 0];
  let lastTap = { time: 0, x: 0, y: 0 };

  canvas.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'touch') return;
    const at = toMapPoint(event.clientX, event.clientY);
    fingers.set(event.pointerId, at);
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // A pointer the browser has already ended can't be captured; the touch still works without it.
    }
    handlers.cancelHold();
    if (fingers.size === 1) {
      phase = 'pressed';
      pressOrigin = at;
      handlers.pressed(at[0], at[1]);
    } else {
      phase = 'pinching';
    }
  });

  canvas.addEventListener('pointermove', (event) => {
    const before = fingers.get(event.pointerId);
    if (event.pointerType !== 'touch' || !before) return;
    const now = toMapPoint(event.clientX, event.clientY);
    if (fingers.size >= 2) {
      const other = [...fingers.entries()].find(([id]) => id !== event.pointerId)![1];
      const distanceBefore = Math.hypot(before[0] - other[0], before[1] - other[1]);
      const distanceNow = Math.hypot(now[0] - other[0], now[1] - other[1]);
      phase = 'pinching';
      handlers.cancelHold();
      handlers.gestureStarted();
      // Zoom about the pair's midpoint, after sliding by how far the moving finger carried it.
      const ratio = distanceBefore > 0 ? distanceNow / distanceBefore : 1;
      handlers.pinch((now[0] + other[0]) / 2, (now[1] + other[1]) / 2, ratio, (now[0] - before[0]) / 2, (now[1] - before[1]) / 2);
    } else if (phase === 'pressed' || phase === 'panning') {
      if (phase === 'pressed') {
        if (Math.hypot(now[0] - pressOrigin[0], now[1] - pressOrigin[1]) < PAN_SLOP_PX) return;
        phase = 'panning';
        handlers.cancelHold();
        handlers.gestureStarted();
        // The slop distance travelled so far is part of the drag.
        handlers.pan(now[0] - pressOrigin[0], now[1] - pressOrigin[1]);
      } else {
        handlers.pan(now[0] - before[0], now[1] - before[1]);
      }
    }
    fingers.set(event.pointerId, now);
  });

  // A tap is handled here rather than left to the mouse events a browser makes up
  // after it: iOS skips those when pointer-move handlers change the page, and then
  // nothing could be tapped. The made-up events are cancelled.
  canvas.addEventListener('touchend', (event) => event.preventDefault(), { passive: false });
  // A long press must not open the browser's own menu or select text under the finger.
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  function release(event: PointerEvent): void {
    if (event.pointerType !== 'touch') return;
    const wasTap = event.type === 'pointerup' && fingers.size === 1 && fingers.has(event.pointerId) && phase === 'pressed' && !handlers.holdFired();
    handlers.cancelHold();
    fingers.delete(event.pointerId);
    if (wasTap) {
      const now = performance.now();
      if (now - lastTap.time < DOUBLE_TAP_MS && Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) < DOUBLE_TAP_SLOP_PX) {
        lastTap.time = 0;
        handlers.doubleTap(...toMapPoint(event.clientX, event.clientY));
      } else {
        lastTap = { time: now, x: event.clientX, y: event.clientY };
        handlers.tap(event.clientX, event.clientY);
      }
    }
    if (fingers.size === 0) {
      phase = 'idle';
      handlers.gestureEnded();
    } else if (fingers.size === 1) {
      // One finger left after a pinch: carry on dragging from where it is.
      phase = 'panning';
    }
  }
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
}
