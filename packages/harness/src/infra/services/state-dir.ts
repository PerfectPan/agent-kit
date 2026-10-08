import type { Platform } from "@rivus/agent-kit-platform";

/**
 * Where harness keeps its state: `$XDG_STATE_HOME/agent-kit/harness`, or `~/.local/state/agent-kit/harness` when the
 * variable is unset or not absolute (the XDG rule). It lies outside the agents' homes and any dotfiles source.
 */
export function harnessStateDir(platform: Pick<Platform, "env" | "home">): string {
  const xdg = platform.env.XDG_STATE_HOME;
  const absolute = xdg !== undefined && (xdg.startsWith("/") || /^[A-Za-z]:[\\/]/.test(xdg));
  return `${absolute ? xdg.replace(/[\\/]+$/, "") : `${platform.home}/.local/state`}/agent-kit/harness`;
}
