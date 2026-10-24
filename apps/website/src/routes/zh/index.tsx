import { createFileRoute, Link } from "@tanstack/react-router";

function LandingZh() {
  return (
    <main>
      <h1>agent-kit 中文</h1>
      <p>
        <Link to="/">English</Link>
      </p>
      <p>
        <Link to="/zh/docs">文档</Link>
      </p>
    </main>
  );
}

export const Route = createFileRoute("/zh/")({
  component: LandingZh
});
