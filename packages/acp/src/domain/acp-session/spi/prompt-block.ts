/**
 * One block of a prompt, in ACP's content block shapes. Which kinds an agent accepts besides text and resource links
 * is in `AcpConnection.capabilities` (`image`, `embeddedContext`).
 */
export type PromptBlock =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image"; readonly data: string; readonly mimeType: string; readonly uri?: string }
  | {
      readonly type: "resource_link";
      readonly uri: string;
      readonly name: string;
      readonly mimeType?: string;
      readonly title?: string;
      readonly description?: string;
      readonly size?: number;
    }
  | {
      readonly type: "resource";
      readonly resource:
        | { readonly uri: string; readonly text: string; readonly mimeType?: string }
        | { readonly uri: string; readonly blob: string; readonly mimeType?: string };
    };
