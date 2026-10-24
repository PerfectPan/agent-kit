import { createFileRoute, Link } from "@tanstack/react-router";

function Landing() {
  return (
    <main>
      <h1>agent-kit</h1>
      <p>
        <Link to="/zh">中文</Link>
      </p>
      <p>
        <Link to="/docs">Docs</Link>
      </p>
    </main>
  );
}

export const Route = createFileRoute("/")({
  component: Landing
});
