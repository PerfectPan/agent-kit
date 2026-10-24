import { createFileRoute } from "@tanstack/react-router";

import { LandingPage } from "../../components/landing/landing-page.tsx";
import landingCss from "../../styles/landing.css?url";

function LandingZh() {
  return <LandingPage lang="zh" />;
}

export const Route = createFileRoute("/zh/")({
  head: () => ({
    links: [{ rel: "stylesheet", href: landingCss }]
  }),
  component: LandingZh
});
