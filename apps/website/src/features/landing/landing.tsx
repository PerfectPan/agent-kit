import { LandingPage } from "./landing-page.tsx";

export function Landing() {
  return (
    <div className="landing-langs">
      <LandingPage lang="en" />
      <LandingPage lang="zh" />
    </div>
  );
}
