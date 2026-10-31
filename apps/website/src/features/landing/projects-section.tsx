import { LandingSection } from "../../components/landing/landing-section.tsx";
import { text, type Lang } from "./copy.ts";
import { GITHUB_URL, builtProjects } from "./projects.ts";
import { ProjectPreview } from "../../components/landing/project-preview.tsx";

export function ProjectsSection({ lang }: { readonly lang: Lang }) {
  return (
    <LandingSection title={text(lang, "builtTitle")} body={text(lang, "builtBody")}>
      <div className="grid grid-cols-2 gap-4 narrow:grid-cols-1">
        {builtProjects.map((project) => (
          <article
            key={project.id}
            className="rounded-container bg-card px-5.5 py-5 shadow-card duration-200 ease-settle hover:shadow-[0_0_0_1px_rgb(42_33_30/0.06),0_8px_24px_-16px_rgb(42_33_30/0.35)] motion-safe:transition-[translate,box-shadow] motion-safe:hover:-translate-y-0.5"
          >
            <ProjectPreview
              variant={project.id === "agent-presence" ? "profile" : "review"}
              copy={{
                sampleData: text(lang, "sampleData"),
                presenceName: text(lang, "presenceName"),
                presenceSig: text(lang, "presenceSig"),
                presenceWorking: text(lang, "presenceWorking"),
                presenceIdle: text(lang, "presenceIdle"),
                presenceTokens: text(lang, "presenceTokens"),
                loopTaskTitle: text(lang, "loopTaskTitle"),
                stepReview: text(lang, "stepReview"),
                agentLabel: text(lang, "agentLabel"),
                loopAgentName: text(lang, "loopAgentName"),
                loopCheckTests: text(lang, "loopCheckTests"),
                loopCheckDiff: text(lang, "loopCheckDiff"),
                loopCheckNotes: text(lang, "loopCheckNotes"),
                loopPrChip: text(lang, "loopPrChip")
              }}
            />
            <h3 className="mb-2 font-mono text-component tracking-[-0.02em] text-balance zh:break-keep">
              {project.id}
            </h3>
            <p className="mb-3 text-body-sm text-ink-2 zh:leading-[1.8]">{text(lang, project.body)}</p>
            <a className="text-ui font-semibold text-ochre hover:underline" href={project.href}>
              {text(lang, project.github)}
            </a>
          </article>
        ))}
      </div>
      <p className="mt-4 text-body-sm">
        <a href={GITHUB_URL} className="text-ink-2 hover:text-ochre">
          {text(lang, "addProject")}
        </a>
      </p>
    </LandingSection>
  );
}
