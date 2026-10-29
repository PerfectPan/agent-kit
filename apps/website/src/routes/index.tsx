import { createFileRoute } from "@tanstack/react-router";

import { Landing } from "../features/landing/landing.tsx";
import landingCss from "../components/landing.css?url";

export const Route = createFileRoute("/")({
  head: () => ({
    links: [{ rel: "stylesheet", href: landingCss }]
  }),
  component: Landing
});
