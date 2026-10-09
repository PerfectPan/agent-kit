import { describe, expect, it } from "vite-plus/test";

import { decodeIsFinal } from "./quiet.js";

describe("quiet sources", () => {
  it("decodes as final when the caller said so, or when the source was quiet at the decode", () => {
    expect(decodeIsFinal({}, 5)).toBe(false);
    expect(decodeIsFinal({ final: true }, 5)).toBe(true);
    expect(decodeIsFinal({ quietBefore: 10 }, 9)).toBe(true);
    expect(decodeIsFinal({ quietBefore: 10 }, 10)).toBe(false);
  });
});
