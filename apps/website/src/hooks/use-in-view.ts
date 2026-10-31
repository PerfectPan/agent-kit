import { useEffect, useRef } from "react";

export function useInView({
  selector,
  visibleAttribute,
  motionAttribute,
  motionValue,
  threshold,
  rootMargin
}: {
  readonly selector: string;
  readonly visibleAttribute: string;
  readonly motionAttribute: string;
  readonly motionValue: string;
  readonly threshold: number;
  readonly rootMargin: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (root === null) {
      return undefined;
    }
    const nodes = root.querySelectorAll(selector);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      for (const node of nodes) {
        node.setAttribute(visibleAttribute, "");
      }
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries, current) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.setAttribute(visibleAttribute, "");
            current.unobserve(entry.target);
          }
        }
      },
      { threshold, rootMargin }
    );
    for (const node of nodes) {
      observer.observe(node);
    }
    const frame = requestAnimationFrame(() => {
      root.setAttribute(motionAttribute, motionValue);
    });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [selector, visibleAttribute, motionAttribute, motionValue, threshold, rootMargin]);

  return rootRef;
}
