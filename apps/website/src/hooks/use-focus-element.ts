import { useCallback } from "react";

export function useFocusElement() {
  return useCallback((id: string) => document.getElementById(id)?.focus(), []);
}
