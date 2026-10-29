declare module "virtual:landing-facts" {
  import type { ShownBudget } from "./features/landing/entry-budgets.ts";
  import type { SupportRow } from "./features/landing/support.ts";

  export interface LandingFacts {
    readonly support: readonly SupportRow[];
    readonly budgets: {
      readonly kit: readonly ShownBudget[];
      readonly collab: readonly ShownBudget[];
    };
    readonly version: string;
    readonly license: string;
    readonly entryCount: number;
    readonly packageCount: number;
    readonly zeroDepCount: number;
  }

  export const landingFacts: LandingFacts;
}
