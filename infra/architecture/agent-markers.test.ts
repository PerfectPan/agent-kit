import { expect, it } from "vite-plus/test";

import { extractAgentMarkers } from "./agent-markers.ts";

const file = "packages/providers/sample/src/facts.ts";

it("reads literals and same-file exported constants without executing imports or statements", () => {
  expect(
    extractAgentMarkers(
      file,
      `
    import "./missing.js";
    throw new Error("must not execute");
    export const agentMarkers: readonly string[] = ["literal", ID, "escaped\\u002dvalue", HOME];
    export const ID: string = "sample", HOME = ".sample";
  `
    )
  ).toEqual(["literal", "sample", "escaped-value", ".sample"]);
});

it.each([
  ["missing", "export const ID = 'sample';"],
  ["non-array", "export const agentMarkers = 'sample';"],
  ["uninitialized", "export const agentMarkers: string[];"],
  ["private", "const agentMarkers = ['sample'];"],
  ["mutable", "export let agentMarkers = ['sample'];"],
  ["resource", "export await using agentMarkers = ['sample'];"],
  ["computed array", "export const agentMarkers = getMarkers();"]
])("rejects a %s marker declaration", (_name, source) => {
  expect(() => extractAgentMarkers(file, source)).toThrow(
    `${file}: agentMarkers: expected an exported const array literal`
  );
});

it.each([
  ["...ID", "export const ID = 'sample';"],
  ["makeMarker()", ""],
  ["IMPORTED", "import { IMPORTED } from './missing.js';"],
  ["MISSING", ""],
  ["PRIVATE", "const PRIVATE = 'sample';"],
  ["MUTABLE", "export let MUTABLE = 'sample';"],
  ["RESOURCE", "export await using RESOURCE = 'sample';"],
  ["ALIAS", "export const ID = 'sample'; export const ALIAS = ID;"],
  ["COMPUTED", "export const COMPUTED = 'sam' + 'ple';"],
  ["42", ""],
  ["`sample`", ""],
  ["ID.value", "export const ID = {value: 'sample'};"],
  ["", ""]
])("rejects marker element %s with its file and position", (element, prefix) => {
  const source = `${prefix}\nexport const agentMarkers = [${element === "" ? "," : element}];`;
  expect(() => extractAgentMarkers(file, source)).toThrow(
    `${file}: agentMarkers[0] (${element || "<empty>"}): expected a string literal or a same-file export const initialized with a string literal`
  );
});

it("rejects duplicate bindings", () => {
  expect(() =>
    extractAgentMarkers(file, `export const ID = 'a'; export const ID = 'b'; export const agentMarkers = [ID];`)
  ).toThrow(`${file}: ID: duplicate exported const`);
});

it("rejects syntax errors", () => {
  expect(() => extractAgentMarkers(file, 'export const agentMarkers = ["sample";')).toThrow(`${file}: source at`);
});
