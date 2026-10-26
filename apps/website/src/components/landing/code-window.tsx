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
    <div className="window">
      {tabs}
      <div role="tabpanel" id={panelId} aria-labelledby={tabId}>
        <div className="file">
          <span>{file}</span>
          <span>{packageName}</span>
        </div>
        {children}
      </div>
    </div>
  );
}
