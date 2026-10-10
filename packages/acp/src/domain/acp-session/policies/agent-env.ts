import type { AcpProfile } from "../value-objects/acp-profile.js";

function matches(pattern: string, name: string): boolean {
  const star = pattern.indexOf("*");
  if (star < 0) {
    return pattern === name;
  }
  const head = pattern.slice(0, star);
  const tail = pattern.slice(star + 1);
  return name.length >= head.length + tail.length && name.startsWith(head) && name.endsWith(tail);
}

/**
 * The variables of `source` that the profile lists, for a caller that builds the agent's environment from its own.
 * A pattern matches when the name has the text before and after its one `*`.
 */
export function agentEnv(
  profile: Pick<AcpProfile, "env">,
  source: Readonly<Record<string, string | undefined>>
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(source)) {
    if (value !== undefined && profile.env.some((pattern) => matches(pattern, name))) {
      env[name] = value;
    }
  }
  return env;
}
