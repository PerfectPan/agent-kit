import type { ReactNode } from "react";

export function CodeWindow({
  tabs,
  panelId,
  tabId,
  file,
  packageName,
  children
}: {
  readonly tabs: ReactNode;
  readonly panelId: string;
  readonly tabId: string;
  readonly file: string;
  readonly packageName: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="relative z-2 overflow-hidden rounded-container bg-code-bg shadow-window motion-safe:animate-[ak-enter_0.75s_var(--ease-enter)_200ms_both]">
      {tabs}
      <div role="tabpanel" id={panelId} aria-labelledby={tabId}>
        <div className="flex items-center justify-between px-5.5 pt-3.5 font-mono text-ui text-code-dim">
          <span>{file}</span>
          <span>{packageName}</span>
        </div>
        {children}
      </div>
    </div>
  );
}
