import { text, type Lang } from "../../lib/landing-copy.ts";
import { GITHUB_URL, builtProjects } from "../../lib/projects.ts";
import { ProjectIllustration } from "./project-illustration.tsx";

export function ProjectsSection({ lang }: { readonly lang: Lang }) {
  return (
    <section className="section reveal">
      <div className="section-head">
        <h2>{text(lang, "builtTitle")}</h2>
        <p className="sub">{text(lang, "builtBody")}</p>
      </div>
      <div className="section-body">
        <div className="cases">
          {builtProjects.map((project) => (
            <article key={project.id} className="case">
              <ProjectIllustration id={project.id} lang={lang} />
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
