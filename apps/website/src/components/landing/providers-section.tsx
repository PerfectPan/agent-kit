import { Link } from "@tanstack/react-router";

import { guide } from "../../lib/guide-paths.ts";
import { CAPABILITIES, type Capability } from "../../lib/support.ts";
import { text, type CopyKey, type Lang } from "../../lib/landing-copy.ts";
import { landingFacts } from "virtual:landing-facts";

const COLUMN_LABEL: Record<Capability, CopyKey> = {
  discovery: "colDetect",
  hooks: "colHooks",
  install: "colInstall",
  sessions: "colSessions",
  usage: "colUsage",
  acp: "colAcp"
};

export function ProvidersSection({ lang }: { readonly lang: Lang }) {
  const providers = guide("concepts/providers");
  return (
    <section className="section reveal" aria-labelledby={`providers-heading-${lang}`}>
      <div className="section-head">
        <h2 id={`providers-heading-${lang}`}>{text(lang, "providersTitle")}</h2>
        <p className="sub">{text(lang, "providersBody")}</p>
      </div>
      <div className="section-body">
        <p className="matrix-legend">{text(lang, "providersLegend")}</p>
        <div className="matrix-wrap">
          <table className="matrix">
            <thead>
              <tr>
                <th scope="col">{text(lang, "agentLabel")}</th>
                {CAPABILITIES.map((capability) => (
                  <th key={capability} scope="col">
                    {text(lang, COLUMN_LABEL[capability])}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {landingFacts.support.map((row) => (
                <tr key={row.id}>
                  <th scope="row">{row.id}</th>
                  {CAPABILITIES.map((capability) => {
                    const supported = row[capability];
                    return (
                      <td key={capability} className={supported ? "y" : "n"}>
                        <span aria-hidden="true">{supported ? "✓" : "–"}</span>
                        <span className="sr">{text(lang, supported ? "supported" : "unsupported")}</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className="add">
                <td colSpan={7}>
                  <Link to={providers.to} params={providers.params}>
                    {text(lang, "addProvider")}
                  </Link>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
