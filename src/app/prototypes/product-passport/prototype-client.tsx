"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import styles from "./prototype.module.css";
import { EvidenceIndex } from "./variant-index";
import { OrbitInstrument } from "./variant-orbit";
import { VARIANTS, type VariantId } from "./prototype-data";
import { SignalConsole } from "./variant-signal";

function PrototypePicker({ current, onSelect, onReplay }: { current: number; onSelect: (index: number) => void; onReplay: () => void }) {
  const pickerRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const picker = pickerRef.current;
    const item = picker?.querySelector<HTMLElement>(`[data-picker-index="${current}"]`);
    const highlight = picker?.querySelector<HTMLElement>(".proto-picker-highlight");
    if (!item || !highlight) return;
    highlight.style.width = `${item.offsetWidth}px`;
    highlight.style.transform = `translateX(${item.offsetLeft}px)`;
  }, [current]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => pickerRef.current?.setAttribute("data-ready", "")));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <nav aria-label="Prototype variants" className="proto-picker" ref={pickerRef}>
      <span aria-hidden="true" className="proto-picker-highlight" />
      {VARIANTS.map((variant, index) => (
        <button
          aria-current={current === index ? "true" : undefined}
          className="proto-picker-item"
          data-active={current === index ? "" : undefined}
          data-picker-index={index}
          key={variant.id}
          onClick={() => onSelect(index)}
          type="button"
        >
          {variant.label}
        </button>
      ))}
      <span aria-hidden="true" className="proto-picker-divider" />
      <button aria-label="Replay animation (R)" className="proto-picker-item proto-picker-replay" onClick={onReplay} type="button">↻</button>
    </nav>
  );
}

function Variant({ id }: { id: VariantId }) {
  if (id === "index") return <EvidenceIndex />;
  if (id === "orbit") return <OrbitInstrument />;
  return <SignalConsole />;
}

export function ProductPassportPrototypeClient({ initialVariant }: { initialVariant: number }) {
  const [current, setCurrent] = useState(initialVariant);
  const [mountKey, setMountKey] = useState(0);

  function selectVariant(index: number) {
    if (index < 0 || index >= VARIANTS.length) return;
    setCurrent(index);
    const url = new URL(window.location.href);
    url.searchParams.set("v", String(index + 1));
    window.history.replaceState(null, "", url);
  }

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const number = Number(event.key);
      if (number >= 1 && number <= VARIANTS.length) selectVariant(number - 1);
      else if (event.key === "ArrowRight") selectVariant((current + 1) % VARIANTS.length);
      else if (event.key === "ArrowLeft") selectVariant((current - 1 + VARIANTS.length) % VARIANTS.length);
      else if (event.key.toLowerCase() === "r") setMountKey((key) => key + 1);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [current]);

  const selectedVariant = VARIANTS[current] ?? VARIANTS[0]!;

  return (
    <div className={styles.prototypeRoot}>
      <main className={styles.prototypeStage} key={`${selectedVariant.id}-${mountKey}`}>
        <Variant id={selectedVariant.id} />
      </main>
      <PrototypePicker current={current} onReplay={() => setMountKey((key) => key + 1)} onSelect={selectVariant} />
    </div>
  );
}
