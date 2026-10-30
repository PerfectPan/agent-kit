const BUTTON =
  "inline-flex items-center gap-2.5 rounded-control px-6 py-3.25 text-[16px] leading-[normal] font-semibold";

/** Links styled as buttons in the hero and the closing call to action. */
export const PRIMARY_BUTTON = `${BUTTON} bg-ochre text-ochre-ink duration-200 ease-settle hover:shadow-[0_6px_18px_color-mix(in_srgb,var(--color-ochre)_28%,transparent)] motion-safe:transition-[translate,box-shadow] motion-safe:hover:-translate-y-px`;
export const GHOST_BUTTON = `${BUTTON} bg-card text-ink shadow-card transition-[translate,box-shadow] duration-200 ease-settle hover:-translate-y-px`;
