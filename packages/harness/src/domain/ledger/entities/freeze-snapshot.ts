/** Deep-clones `input`, freezes each listed field plus the snapshot itself, and assigns and freezes `target`. */
export function initFrozenSnapshot<T extends object>(target: object, input: T, fields: readonly (keyof T)[]): T {
  const snapshot = structuredClone(input);
  for (const field of fields) {
    Object.freeze(snapshot[field]);
  }
  Object.freeze(snapshot);
  Object.assign(target, snapshot);
  Object.freeze(target);
  return snapshot;
}
