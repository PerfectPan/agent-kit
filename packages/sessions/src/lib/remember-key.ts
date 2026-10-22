/** Remembers `key` among the last `size` keys, dropping the oldest. */
export function rememberKey(keys: string[], key: string, size: number): void {
  keys.push(key);
  if (keys.length > size) {
    keys.splice(0, keys.length - size);
  }
}
