import { registerHooks } from "node:module";

// Worker processes run the package's TypeScript sources with Node's type stripping. The sources import siblings as
// `./x.js`, as the bundler expects; this hook falls back to `./x.ts` when no `.js` file exists.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      const notFound = (error as { code?: unknown }).code === "ERR_MODULE_NOT_FOUND";
      if (notFound && specifier.startsWith(".") && specifier.endsWith(".js")) {
        return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
      }
      throw error;
    }
  }
});
