import { SectionHeading } from "../../components/landing/section-heading.tsx";
import { text, type Lang } from "./copy.ts";
import { GITHUB_URL, builtProjects } from "./projects.ts";
import { ProjectPreview } from "../../components/landing/project-preview.tsx";

export function ProjectsSection({ lang }: { readonly lang: Lang }) {
  return (
    <section className="section reveal">
      <SectionHeading title={text(lang, "builtTitle")} body={text(lang, "builtBody")} />
      <div className="section-body">
        <div className="cases">
          {builtProjects.map((project) => (
            <article key={project.id} className="case">
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
              <h3>{project.id}</h3>
              <p>{text(lang, project.body)}</p>
              <a className="case-link" href={project.href}>
                {text(lang, project.github)}
              </a>
            </article>
          ))}
        </div>
        <p className="add-project">
          <a href={GITHUB_URL}>{text(lang, "addProject")}</a>
        </p>
      </div>
    </section>
  );
}
