import { createFileRoute } from "@tanstack/react-router";

import { LandingPage } from "../components/landing/landing-page.tsx";
import { landingRedirectScript } from "../lib/lang-preference.ts";
import landingCss from "../styles/landing.css?url";

function Landing() {
  return <LandingPage lang="en" />;
}

export const Route = createFileRoute("/")({
  head: () => ({
    links: [{ rel: "stylesheet", href: landingCss }],
    scripts: [{ children: landingRedirectScript() }]
  }),
  component: Landing
});
