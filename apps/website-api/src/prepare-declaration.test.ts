import { expect, it } from "vite-plus/test";

import { absolutizeRelativeImports, prepareEntrySource } from "./prepare-declaration.ts";

const PROVIDER = "interface Provider { readonly id: string }\n";
const PROVIDER_OPTIONS = `type ProviderOptions<T> = T extends unknown ? Omit<T, "providers"> & {
  readonly providers?: readonly Provider[];
} : never;
`;

it("turns a bundled options alias into the public interface and copies the inner comment", () => {
  const prepared = prepareEntrySource(`${PROVIDER}${PROVIDER_OPTIONS}
interface ListSessionsOptions$1 {
  /** Agents to list. */
  readonly agents?: readonly string[];
  readonly providers: { readonly sessions: string };
  readonly signal?: AbortSignal;
}
/**
 * Lists the sessions of each agent.
 */
declare function listSessions$1(platform: string, options: ListSessionsOptions$1): AsyncGenerator<string>;
type ListSessionsOptions = ProviderOptions<Parameters<typeof listSessions$1>[1]>;
export declare function listSessions(platform: Parameters<typeof listSessions$1>[0], options?: ListSessionsOptions): ReturnType<typeof listSessions$1>;
`);
  const iface = prepared.slice(
    prepared.indexOf("export interface ListSessionsOptions"),
    prepared.indexOf("export declare function listSessions")
  );
  expect(iface).toContain("/** Agents to list. */");
  expect(iface).toContain("readonly agents?: readonly string[];");
  expect(iface).toContain("readonly signal?: AbortSignal;");
  expect(iface).toContain("readonly providers?: readonly Provider[];");
  expect(iface).not.toContain("$1");
  expect(iface).not.toContain("sessions: string");
  expect(prepared.indexOf("Lists the sessions of each agent.")).toBeLessThan(
    prepared.indexOf("export declare function listSessions")
  );
  expect(prepared).toContain("type ProviderOptions<T>");
});

it("flattens an extended options interface and drops keys the public signature omits", () => {
  const prepared = prepareEntrySource(`${PROVIDER}${PROVIDER_OPTIONS}
interface ScopeOptions {
  /** user by default. */
  readonly scope?: string;
}
interface DoctorOptions$1 extends ScopeOptions {
  readonly owner?: string;
  readonly providers: { readonly install: string };
}
declare function doctor$1(options: DoctorOptions$1): string;
type DoctorOptions = ProviderOptions<Parameters<typeof doctor$1>[0]>;
export declare function doctor(options?: DoctorOptions): string;
`);
  const iface = prepared.slice(
    prepared.indexOf("export interface DoctorOptions"),
    prepared.indexOf("export declare function doctor")
  );
  expect(iface).toContain("readonly scope?: string;");
  expect(iface).toContain("readonly owner?: string;");
  expect(iface).toContain("readonly providers?: readonly Provider[];");
  expect(iface).not.toContain("install: string");
});

it("names an anonymous ProviderOptions parameter and omits the inner progress callback", () => {
  const prepared = prepareEntrySource(`${PROVIDER}${PROVIDER_OPTIONS}
interface LoadTranscriptOptions$1 {
  readonly providers: { readonly sessions: string };
  readonly signal?: AbortSignal;
  /** Called as bytes are read. */
  readonly onProgress?: (bytes: number) => void;
}
/**
 * Summarizes one session.
 */
declare function summarizeSession$1(platform: string, target: string, options: Omit<LoadTranscriptOptions$1, "onProgress"> & {
  readonly prompts?: string;
}): Promise<string>;
export declare function summarizeSession(platform: string, target: string, options?: ProviderOptions<Parameters<typeof summarizeSession$1>[2]>): Promise<string>;
`);
  expect(prepared).toContain("export interface SummarizeSessionOptions {");
  expect(prepared).toContain("options?: SummarizeSessionOptions");
  const iface = prepared.slice(
    prepared.indexOf("export interface SummarizeSessionOptions"),
    prepared.indexOf("export declare function summarizeSession")
  );
  expect(iface).toContain("readonly signal?: AbortSignal;");
  expect(iface).toContain("readonly prompts?: string;");
  expect(iface).not.toContain("onProgress");
  expect(prepared).toContain("Summarizes one session.");
});

it("keeps a union of option shapes and drops the required providers field", () => {
  const prepared = prepareEntrySource(`${PROVIDER}${PROVIDER_OPTIONS}
interface ScanUsageCommon {
  readonly providers: { readonly usage: string };
  readonly signal?: AbortSignal;
}
type ScanUsageOptions$1 = ScanUsageCommon & ({
  readonly since?: number;
} | {
  readonly since: number;
  readonly state?: string;
});
declare function scanUsage$1(platform: string, options: ScanUsageOptions$1): string;
type ScanUsageOptions = ProviderOptions<Parameters<typeof scanUsage$1>[1]>;
export declare function scanUsage(platform: string, options?: ScanUsageOptions): string;
`);
  const exported = prepared.slice(
    prepared.indexOf("export type ScanUsageOptions"),
    prepared.indexOf("export declare function scanUsage")
  );
  expect(exported).toContain("readonly signal?: AbortSignal;");
  expect(exported).toContain("readonly since?: number;");
  expect(exported).toContain("readonly state?: string;");
  expect(exported).toContain("readonly providers?: readonly Provider[];");
  expect(exported).not.toContain("$1");
  expect(exported).not.toContain("usage: string");
});

it("names an inline options object on an exported function", () => {
  const prepared = prepareEntrySource(`${PROVIDER}
export declare function sessionAdapterHome(adapter: string, options?: {
  readonly providers?: readonly Provider[];
}): string;
`);
  expect(prepared).toContain("export interface SessionAdapterHomeOptions {");
  expect(prepared).toContain("readonly providers?: readonly Provider[];");
  expect(prepared).toContain("options?: SessionAdapterHomeOptions");
});

it("rewrites relative declaration imports to absolute paths", () => {
  const prepared = absolutizeRelativeImports(
    'import { t as Provider } from "./types-BGDWMU2n.js";\nimport { x } from "../effect-chunk.js";\nimport { y } from "effect/Effect";\n',
    "/pkg/dist/harness"
  );
  expect(prepared).toContain('from "/pkg/dist/harness/types-BGDWMU2n.js"');
  expect(prepared).toContain('from "/pkg/dist/effect-chunk.js"');
  expect(prepared).toContain('from "effect/Effect"');
});

it("leaves an export that already documents itself", () => {
  const source = `${PROVIDER}/** Hides a home directory. */\nexport declare function redact(text: string): string;\n`;
  expect(prepareEntrySource(source)).toBe(source);
});

it("imports Provider when the prepared options name it and the entry does not", () => {
  const prepared = prepareEntrySource(`${PROVIDER_OPTIONS}
import { n as ProviderOptions } from "./types-BGDWMU2n.js";
interface ListSessionsOptions$1 {
  readonly agents?: readonly string[];
  readonly providers: { readonly sessions: string };
}
declare function listSessions$1(platform: string, options: ListSessionsOptions$1): string;
type ListSessionsOptions = ProviderOptions<Parameters<typeof listSessions$1>[1]>;
export declare function listSessions(platform: string, options?: ListSessionsOptions): string;
`);
  expect(prepared).toContain('import { t as Provider, n as ProviderOptions } from "./types-BGDWMU2n.js"');
});
