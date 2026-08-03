/**
 * Which tail is currently selected for drawing a route — set by clicking a
 * row in the Fleet panel (ui/panels.ts), read by the M10 route builder
 * (ui/routeBuilder.ts) to require picking a plane *before* arming a route,
 * not after. Lives in its own tiny module rather than either of those two,
 * since panels.ts and routeBuilder.ts already import from each other in
 * the other direction (routeBuilder.ts uses panels.ts's warning and
 * time-formatting helpers) — putting this here avoids a circular import
 * between them.
 *
 * Transient UI state, not simulated-world state, same reasoning as
 * routeBuilder.ts's own `builderState`: it doesn't belong in `SimState`.
 */
let selectedTail: string | null = null;

export function getSelectedTail(): string | null {
  return selectedTail;
}

export function setSelectedTail(tail: string | null): void {
  selectedTail = tail;
}
