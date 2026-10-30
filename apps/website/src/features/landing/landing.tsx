import { LandingPage } from "./landing-page.tsx";

export function Landing() {
  return (
    // Both language trees share one grid cell. An auto track would grow to the code window's longest line and widen
    // the page on phones, hence minmax(0, 1fr).
    <div className="landing-langs grid grid-cols-[minmax(0,1fr)]">
      <LandingPage lang="en" />
      <LandingPage lang="zh" />
    </div>
  );
}
