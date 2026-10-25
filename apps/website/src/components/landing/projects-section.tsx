import { text, type Lang } from "../../lib/landing-copy.ts";
import { builtProjects } from "../../lib/projects.ts";
import { ProjectIllustration } from "./project-illustration.tsx";

export function ProjectsSection({ lang }: { readonly lang: Lang }) {
  return (
    <section className="section reveal">
      <h2>{text(lang, "builtTitle")}</h2>
      <p className="sub">{text(lang, "builtBody")}</p>
      <div className="cases">
        {builtProjects.map((project) => (
          <a key={project.id} className={project.yours ? "case yours" : "case"} href={project.href}>
            {project.id === "agent-presence" || project.id === "agent-task-loop" ? (
              <ProjectIllustration id={project.id} lang={lang} />
            ) : null}
            <h3>{project.title ? text(lang, project.title) : project.id}</h3>
            <p>{text(lang, project.body)}</p>
            {project.chips.length > 0 ? (
              <div className="chips">
                {project.chips.map((chip) => (
                  <code key={chip.label} className={chip.highlight ? "mark" : undefined}>
                    {chip.label}
                  </code>
                ))}
              </div>
            ) : null}
          </a>
        ))}
      </div>
    </section>
  );
}
