import { LandingPage } from "./landing-page.tsx";

export function Landing() {
  return (
    // Both language trees share one grid cell. An auto track would grow to the code window's longest line and widen
    // the page on phones; grid-cols-1 is minmax(0, 1fr). landing.css styles <body> from data-landing.
    <div data-landing="" className="grid grid-cols-1">
      <LandingPage lang="en" />
      <LandingPage lang="zh" />
    </div>
  );
}
