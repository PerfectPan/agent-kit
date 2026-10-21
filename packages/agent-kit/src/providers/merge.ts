import type { Provider } from "./types.js";

type Service = Exclude<keyof Provider, "id">;

/** Merge one service independently; object spread preserves the built-in table's precedence order. */
export function mergeService<K extends Service>(
  service: K,
  builtins: Readonly<Partial<Record<string, Provider[K]>>>,
  providers: readonly Provider[] = []
): Readonly<Partial<Record<string, Provider[K]>>> {
  return {
    ...builtins,
    ...Object.fromEntries(
      providers.flatMap((provider) => {
        const implementation = provider[service];
        return implementation == null ? [] : [[provider.id, implementation]];
      })
    )
  };
}
