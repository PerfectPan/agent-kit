declare module "virtual:landing-facts" {
  import type { ShownBudget } from "./lib/entry-budgets.ts";
  import type { SupportRow } from "./lib/support.ts";

  export interface LandingFacts {
    readonly support: readonly SupportRow[];
    readonly budgets: {
      readonly kit: readonly ShownBudget[];
      readonly collab: readonly ShownBudget[];
    };
    readonly version: string;
    readonly license: string;
  }

  export const landingFacts: LandingFacts;
}
