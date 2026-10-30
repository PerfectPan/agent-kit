import { SupportTable } from "../../components/landing/support-table.tsx";
import { SectionHeading } from "../../components/landing/section-heading.tsx";
import { Link } from "@tanstack/react-router";

import { guide } from "../docs/index.ts";
import { CAPABILITIES, type Capability } from "./support.ts";
import { text, type CopyKey, type Lang } from "./copy.ts";
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
    <section
      className="reveal grid grid-cols-[minmax(0,1fr)] gap-x-12 gap-y-5 pt-16"
      aria-labelledby={`providers-heading-${lang}`}
    >
      <SectionHeading
        id={`providers-heading-${lang}`}
        title={text(lang, "providersTitle")}
        body={text(lang, "providersBody")}
      />
      <div>
        <p className="mb-2.5 text-body-sm text-pretty text-ink-2 zh:[line-break:strict]">
          {text(lang, "providersLegend")}
        </p>
        <SupportTable
          label={text(lang, "agentLabel")}
          columns={CAPABILITIES.map((capability) => ({ id: capability, label: text(lang, COLUMN_LABEL[capability]) }))}
          rows={landingFacts.support.map((row) => ({
            id: row.id,
            cells: CAPABILITIES.map((capability) => ({ id: capability, supported: row[capability] }))
          }))}
          supportedLabel={text(lang, "supported")}
          unsupportedLabel={text(lang, "unsupported")}
          supportedMark="✓"
          unsupportedMark="–"
          footer={
            <Link to={providers.to} params={providers.params} className="hover:underline">
              {text(lang, "addProvider")}
            </Link>
          }
        />
      </div>
    </section>
  );
}
