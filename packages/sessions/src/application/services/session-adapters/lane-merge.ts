/** The next running-maximum clock value: a non-finite recorded time leaves the previous one. */
export function advanceTime(previous: number, time: number): number {
  return Number.isFinite(time) ? Math.max(previous, time) : previous;
}

/** Compare monotonic lane clocks, retaining recorded times and every lane's original event order. Ties favor earlier lanes. */
export function mergeLanes<T extends { ts: number }>(lanes: readonly (readonly T[])[]): T[] {
  const positions = lanes.map(() => 0);
  const clocks = lanes.map(() => -Infinity);
  const merged: T[] = [];
  for (;;) {
    let selected = -1;
    let selectedTime = Infinity;
    for (let lane = 0; lane < lanes.length; lane++) {
      const head = lanes[lane]![positions[lane]!];
      if (head === undefined) {
        continue;
      }
      const time = advanceTime(clocks[lane]!, head.ts);
      if (selected < 0 || time < selectedTime) {
        selected = lane;
        selectedTime = time;
      }
    }
    if (selected < 0) {
      return merged;
    }
    merged.push(lanes[selected]![positions[selected]!]!);
    positions[selected]! += 1;
    clocks[selected] = selectedTime;
  }
}
