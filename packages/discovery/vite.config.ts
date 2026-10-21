import { fmt, lint } from "@perfectpan/lint-config/vite-plus";
import { defineConfig } from "vite-plus";

import { withBoundaryLint } from "../../infra/architecture/lint.ts";

export default defineConfig({ fmt, lint: withBoundaryLint(lint, import.meta.url) });
