import { expect, it } from "vite-plus/test";

import { homeFromRule } from "./home-from-rule.js";

it.each([
  ["/u/me", "", "/u/me/data"],
  ["/", "", "/data"],
  ["C:\\", "", "C:\\data"],
  ["C:\\Users\\me", "", "C:\\Users\\me/data"],
  ["/u/me", "  ~/a/../b/  ", "/u/me/a/../b/logs"],
  ["/u/me", "//server/share/", "//server/share/logs"]
])("preserves home spelling for %j and override %j", (home, override, expected) => {
  expect(
    homeFromRule(
      "demo",
      { envVar: "DEMO_HOME", envSubpath: ["logs"], expandsTilde: true, defaultPath: ["data"] },
      {
        home,
        env: { DEMO_HOME: override }
      }
    )
  ).toEqual({
    agent: "demo",
    path: expected,
    source: override ? { kind: "env", variable: "DEMO_HOME" } : { kind: "default" }
  });
});
