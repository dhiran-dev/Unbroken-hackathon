"use client";

import { useEffect, useRef, useState } from "react";

type Point = { x: number; y: number };

export function SmoothCursor({ className }: { className?: string }) {
  const cursorRef = useRef<HTMLDivElement>(null);
  const target = useRef<Point>({ x: 0, y: 0 });
  const current = useRef<Point>({ x: 0, y: 0 });
  const velocity = useRef<Point>({ x: 0, y: 0 });
  const [enabled, setEnabled] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const fine = window.matchMedia("(any-hover: hover) and (any-pointer: fine)");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setEnabled(fine.matches && !reduce.matches);
    update();
    fine.addEventListener("change", update);
    reduce.addEventListener("change", update);
    return () => {
      fine.removeEventListener("change", update);
      reduce.removeEventListener("change", update);
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let frame = 0;
    let running = true;

    const move = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      target.current = { x: event.clientX, y: event.clientY };
      if (!visible) {
        current.current = target.current;
        setVisible(true);
      }
    };

    const tick = () => {
      const spring = 0.18;
      const damping = 0.72;
      velocity.current.x =
        (velocity.current.x + (target.current.x - current.current.x) * spring) * damping;
      velocity.current.y =
        (velocity.current.y + (target.current.y - current.current.y) * spring) * damping;
      current.current.x += velocity.current.x;
      current.current.y += velocity.current.y;

      const angle = Math.atan2(velocity.current.y, velocity.current.x) * (180 / Math.PI);
      if (cursorRef.current) {
        cursorRef.current.style.transform =
          `translate3d(${current.current.x}px, ${current.current.y}px, 0) rotate(${angle}deg)`;
      }
      if (running) frame = requestAnimationFrame(tick);
    };

    window.addEventListener("pointermove", move, { passive: true });
    frame = requestAnimationFrame(tick);
    return () => {
      running = false;
      window.removeEventListener("pointermove", move);
      cancelAnimationFrame(frame);
    };
  }, [enabled, visible]);

  if (!enabled) return null;

  return (
    <div
      aria-hidden="true"
      className={className}
      data-visible={visible ? "true" : "false"}
      ref={cursorRef}
    >
      <span />
    </div>
  );
}
