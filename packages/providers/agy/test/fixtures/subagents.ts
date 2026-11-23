// Sanitized records of the subagent conversation layout: a parent's `invoke_subagent` call and result, and the
// spawned conversation's own transcript, which starts with the message that spawned it.

const LOGS = ".system_generated/logs";

function step(index: number, source: string, type: string, second: number, fields: Record<string, unknown>): string {
  return JSON.stringify({
    step_index: index,
    source,
    type,
    status: "DONE",
    created_at: `2026-11-18T11:00:0${second}Z`,
    ...fields
  });
}

/** The `content` of a `SYSTEM_MESSAGE` relaying the message `sender` sent: a spawned conversation's first record. */
export function relayedMessage(sender: string, content: string): string {
  return (
    "The following is a <SYSTEM_MESSAGE> not actually sent by the user. It is provided by the system as important " +
    "information to pay attention to.\n\n<SYSTEM_MESSAGE>\n" +
    `[Message] timestamp=2026-11-18T11:00:00Z sender=${sender} priority=MESSAGE_PRIORITY_HIGH content=${content}\n` +
    "</SYSTEM_MESSAGE>"
  );
}

/** The `content` of an `invoke_subagent` result: free-form text around the JSON object naming the new conversation. */
export function subagentCreated(conversationId: string): string {
  return (
    "Created At: 2026-11-18T11:00:01+00:00\nCompleted At: 2026-11-18T11:00:02+00:00\nCreated the following subagent:\n" +
    "{\n" +
    `  "conversationId":  "${conversationId}",\n` +
    '  "logAbsoluteUri":  "file:///u/me/.gemini/antigravity-cli/brain/' +
    `${conversationId}/${LOGS}/transcript.jsonl",\n` +
    '  "workspaceUris":  [\n    "file:///u/me/work"\n  ]\n' +
    "}\n" +
    "The subagent will send you a message when it has completed its task or requires guidance. There is no need to " +
    "poll for it"
  );
}

function invokeCall(role: string): { name: string; args: Record<string, string> } {
  return { name: "invoke_subagent", args: { Prompt: `Handle the ${role} work.`, Role: role, TypeName: "research" } };
}

/** A `PLANNER_RESPONSE` spawning one subagent per role, each followed by the result naming its conversation. */
function spawnSteps(firstIndex: number, roles: readonly string[], conversations: readonly string[]): string[] {
  const out = [
    step(firstIndex, "MODEL", "PLANNER_RESPONSE", 1, {
      model: "gemini-test",
      input_tokens: 100,
      output_tokens: 10,
      thinking: "Delegate the work.",
      tool_calls: roles.map(invokeCall)
    })
  ];
  conversations.forEach((conversation, at) => {
    out.push(step(firstIndex + 1 + at, "MODEL", "GENERIC", 2 + at, { content: subagentCreated(conversation) }));
  });
  return out;
}

/**
 * The conversation tree of the nested-subagent cases, as the files under `brain`: `conv-root` spawns `sub-a` and
 * `sub-gone`, whose transcript does not exist; `sub-a` spawns `sub-b` and `conv-root` again, a loop that adds no
 * lane. `sub-b` carries a user record, which counts no turn of the session. The root and `sub-b` keep only the
 * compact transcript, `sub-a` only the full one.
 */
export function nestedConversations(brain: string): Record<string, string> {
  const file = (conversation: string, name = "transcript.jsonl"): string =>
    `${brain}/${conversation}/${LOGS}/${name}`;
  const jsonl = (lines: readonly string[]): string => `${lines.join("\n")}\n`;
  return {
    [file("conv-root")]: jsonl([
      step(0, "USER_EXPLICIT", "USER_INPUT", 0, { content: "Fix it" }),
      ...spawnSteps(1, ["Worker", "Missing"], ["sub-a", "sub-gone"]),
      step(4, "MODEL", "PLANNER_RESPONSE", 8, { model: "gemini-test", input_tokens: 50, output_tokens: 5, content: "Done." }),
      step(5, "SYSTEM", "CHECKPOINT", 9, { model: "gemini-test", input_tokens: 60, output_tokens: 7, content: "Compacted." })
    ]),
    [file("sub-a", "transcript_full.jsonl")]: jsonl([
      step(0, "SYSTEM", "SYSTEM_MESSAGE", 3, { content: relayedMessage("conv-root", "Handle the Worker work.") }),
      ...spawnSteps(1, ["Nested", "Loop"], ["sub-b", "conv-root"])
    ]),
    [file("sub-b")]: jsonl([
      step(0, "SYSTEM", "SYSTEM_MESSAGE", 4, { content: relayedMessage("sub-a", "Handle the Nested work.") }),
      step(1, "USER_EXPLICIT", "USER_INPUT", 5, { content: "A user record on a subagent lane" }),
      step(2, "MODEL", "PLANNER_RESPONSE", 6, { model: "gemini-test", input_tokens: 20, output_tokens: 5, content: "Nested done." })
    ])
  };
}
