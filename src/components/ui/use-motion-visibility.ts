"use client";

import {
  type ForwardedRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";

export function useMotionVisibility(
  forwardedRef: ForwardedRef<HTMLButtonElement>,
) {
  const localRef = useRef<HTMLButtonElement | null>(null);
  useImperativeHandle(forwardedRef, () => localRef.current as HTMLButtonElement);

  useEffect(() => {
    const node = localRef.current;
    if (!node) return;

    let intersecting = true;
    const sync = () => {
      node.dataset.motionVisible = String(
        intersecting && document.visibilityState === "visible",
      );
    };
    const observer = new IntersectionObserver(([entry]) => {
      intersecting = entry?.isIntersecting ?? false;
      sync();
    });

    observer.observe(node);
    document.addEventListener("visibilitychange", sync);
    sync();
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  return localRef;
}
