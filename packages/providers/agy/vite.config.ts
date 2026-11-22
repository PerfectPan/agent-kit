import { packageViteConfig } from "../../../infra/architecture/lint.ts";

export default packageViteConfig(import.meta.url, { ignoreFixtures: true });
