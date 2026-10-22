export interface NameValue {
  readonly name: string;
  readonly value: string;
}

/**
 * An MCP server the agent connects to for one session, in ACP's shapes: a command the agent starts (`stdio`, the
 * default when `type` is absent), or a URL over streamable HTTP or SSE. Which transports an agent supports besides
 * stdio is in `AcpConnection.capabilities` (`mcpHttp`, `mcpSse`). The caller decides who implements the server.
 */
export type McpServerConfig =
  | {
      readonly type?: "stdio";
      readonly name: string;
      readonly command: string;
      readonly args: readonly string[];
      readonly env: readonly NameValue[];
    }
  | {
      readonly type: "http" | "sse";
      readonly name: string;
      readonly url: string;
      readonly headers: readonly NameValue[];
    };
