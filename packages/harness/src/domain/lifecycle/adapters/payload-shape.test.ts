import { describe, expect, it } from "vite-plus/test";

import { payloadView } from "./payload-shape.js";

describe("payloadView", () => {
  it("does not enumerate object or array levels or read unrelated getters", () => {
    for (const [container, key] of [
      [{ field: "value" }, "field"],
      [["value"], "0"]
    ] as const) {
      const payload = new Proxy(
        Object.defineProperty(container, "unrelated", {
          enumerable: true,
          get() {
            throw new Error("unrelated getter");
          }
        }),
        {
          ownKeys() {
            throw new Error("enumerated level");
          }
        }
      );
      expect(payloadView(payload).get([key])).toBe("value");
    }
  });

  it("reads non-enumerable own keys on a null-prototype object", () => {
    const payload: unknown = Object.create(null, { field: { value: "value" } });
    expect(payloadView(payload).get(["field"])).toBe("value");
  });

  it("rejects a callable container even when the requested key is its own", () => {
    const payload = Object.assign(() => undefined, { field: "value" });
    expect(payloadView(payload).get(["field"])).toBeUndefined();
  });
});
