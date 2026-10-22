/** Epoch milliseconds from a record's time field: seconds or milliseconds, or an ISO string. Missing is `undefined`. */
export function timeOf(value: number | string | undefined): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === "string" && value) {
    const ms = Date.parse(value);
    if (!Number.isNaN(ms)) {
      return ms;
    }
  }
  return undefined;
}
