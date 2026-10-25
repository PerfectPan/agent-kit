import { createFileRoute } from "@tanstack/react-router";

import { LandingPage } from "../components/landing/landing-page.tsx";
import landingCss from "../styles/landing.css?url";

function Landing() {
  return (
    <div className="landing-langs">
      <LandingPage lang="en" />
      <LandingPage lang="zh" />
    </div>
  );
}

export const Route = createFileRoute("/")({
  head: () => ({
    links: [{ rel: "stylesheet", href: landingCss }]
  }),
  component: Landing
});
