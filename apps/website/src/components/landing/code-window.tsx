import type { ReactNode } from "react";

import { Tabs, TabsContent } from "../ui/tabs.tsx";

export function CodeWindow({
  tabs,
  value,
  onValueChange,
  panelId,
  tabId,
  file,
  packageName,
  children
}: {
  readonly tabs: ReactNode;
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly panelId: string;
  readonly tabId: string;
  readonly file: string;
  readonly packageName: string;
  readonly children: ReactNode;
}) {
  return (
    <Tabs
      value={value}
      onValueChange={onValueChange}
      className="relative z-2 overflow-hidden rounded-container bg-code-bg shadow-window [--enter-delay:200ms] motion-safe:animate-enter"
    >
      {tabs}
      {/* One panel follows the selected tab. Its buttons are the tab stops, so it does not take Radix's tabIndex. */}
      <TabsContent value={value} id={panelId} aria-labelledby={tabId} tabIndex={undefined}>
        <div className="flex items-center justify-between px-5.5 pt-3.5 font-mono text-ui text-code-dim">
          <span>{file}</span>
          <span>{packageName}</span>
        </div>
        {children}
      </TabsContent>
    </Tabs>
  );
}
