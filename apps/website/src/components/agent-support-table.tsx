import { landingFacts } from "virtual:landing-facts";

import { AGENT_IDENTITY } from "../lib/agent-identity.ts";
import { text } from "../lib/landing-copy.ts";
import { CAPABILITIES, type Capability, type SupportRow } from "../lib/support.ts";
import { useLanguage } from "./root-shell.tsx";

const COLUMN_LABEL: Record<
  Capability,
  "colDetect" | "colHooks" | "colInstall" | "colSessions" | "colUsage" | "colAcp"
> = {
  discovery: "colDetect",
  hooks: "colHooks",
  install: "colInstall",
  sessions: "colSessions",
  usage: "colUsage",
  acp: "colAcp"
};

const HEAD = {
  en: { agent: "Agent", id: "Id", aliases: "Aliases", home: "Home", none: "—" },
  zh: { agent: "Agent", id: "Id", aliases: "别名", home: "主目录", none: "—" }
} as const;

function rows(): readonly (SupportRow & (typeof AGENT_IDENTITY)[number])[] {
  const byId = new Map(AGENT_IDENTITY.map((identity) => [identity.id, identity]));
  const joined = landingFacts.support.map((row) => {
    const identity = byId.get(row.id);
    if (!identity) {
      throw new Error(`No identity for ${row.id}`);
    }
    byId.delete(row.id);
    return { ...identity, ...row };
  });
  if (byId.size > 0) {
    throw new Error(`Identity without a provider: ${[...byId.keys()].join(", ")}`);
  }
  return joined;
}

export function AgentSupportTable() {
  const { lang } = useLanguage();
  const head = HEAD[lang];
  const table = rows();

  return (
    <table>
      <thead>
        <tr>
          <th scope="col">{head.agent}</th>
          <th scope="col">{head.id}</th>
          <th scope="col">{head.aliases}</th>
          <th scope="col">{head.home}</th>
          {CAPABILITIES.map((capability) => (
            <th key={capability} scope="col">
              {text(lang, COLUMN_LABEL[capability])}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {table.map((row) => (
          <tr key={row.id}>
            <th scope="row">{row.name}</th>
            <td>
              <code>{row.id}</code>
            </td>
            <td>
              {row.aliases.length === 0 ? head.none : row.aliases.map((alias) => <code key={alias}>{alias}</code>)}
            </td>
            <td>{row.home[lang]}</td>
            {CAPABILITIES.map((capability) => (
              <td key={capability}>{text(lang, row[capability] ? "supported" : "unsupported")}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
