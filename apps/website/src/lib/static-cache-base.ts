const CACHE_PREFIX = "/__tsr/staticServerFnCache/";

// Published staticFunctionMiddleware requests this cache at the origin root.
// GitHub Pages serves the site under Vite's base, so prefix only that path.
if (import.meta.env.PROD && typeof document !== "undefined") {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const original = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === "string" && input.startsWith(CACHE_PREFIX)) {
      return original(`${base}${input}`, init);
    }
    return original(input, init);
  };
}
