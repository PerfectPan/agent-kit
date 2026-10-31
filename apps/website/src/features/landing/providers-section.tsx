import { SupportTable } from "../../components/landing/support-table.tsx";
import { LandingSection } from "../../components/landing/landing-section.tsx";
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
    <LandingSection
      aria-labelledby={`providers-heading-${lang}`}
      headingId={`providers-heading-${lang}`}
      title={text(lang, "providersTitle")}
      body={text(lang, "providersBody")}
    >
      <p className="mb-2.5 text-body-sm text-ink-2">{text(lang, "providersLegend")}</p>
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
    </LandingSection>
  );
}
