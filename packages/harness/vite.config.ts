import { packageViteConfig } from "../../infra/architecture/lint.ts";

export default packageViteConfig(import.meta.url, {
  effectTestBlocks: ["it.effect", "it.effect.each", "it.live"]
});
