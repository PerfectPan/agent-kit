import { useTransientState } from "./use-transient-state.ts";

export function useClipboard(value: string, delay = 1500) {
  const [copied, setCopied] = useTransientState(false, delay);
  function copy() {
    void navigator.clipboard.writeText(value).then(
      () => setCopied(true),
      () => setCopied(false)
    );
  }
  return { copied, copy };
}
