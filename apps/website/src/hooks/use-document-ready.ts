import { useLayoutEffect } from "react";

export function useDocumentReady(key: string, ready: boolean, pendingClass: string): void {
  useLayoutEffect(() => {
    if (ready) {
      document.documentElement.classList.remove(pendingClass);
    }
  }, [key, ready, pendingClass]);
}
