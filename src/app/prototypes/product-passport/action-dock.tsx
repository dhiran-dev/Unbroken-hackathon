"use client";

import {
  Bookmark,
  Check,
  GitCompareArrows,
  Plus,
} from "lucide-react";
import { useState } from "react";

import styles from "./prototype.module.css";

export function ActionDock({ compact = false }: { compact?: boolean }) {
  const [saved, setSaved] = useState(false);
  const [compared, setCompared] = useState(false);
  const [message, setMessage] = useState("Browser-local actions");

  return (
    <aside aria-label="Prototype local actions" className={`${styles.actionDock} ${compact ? styles.actionDockCompact : ""}`}>
      <button
        aria-pressed={saved}
        onClick={() => {
          setSaved((current) => !current);
          setMessage(saved ? "Removed from this browser." : "Saved in this browser.");
        }}
        type="button"
      >
        {saved ? <Check aria-hidden="true" /> : <Bookmark aria-hidden="true" />}
        <span>{saved ? "Saved" : "Save"}</span>
      </button>
      <button
        aria-pressed={compared}
        onClick={() => {
          setCompared((current) => !current);
          setMessage(compared ? "Removed from Compare." : "Added to Compare.");
        }}
        type="button"
      >
        <GitCompareArrows aria-hidden="true" />
        <span>{compared ? "In Compare" : "Compare"}</span>
      </button>
      <button onClick={() => setMessage("Added to My Day in this browser.")} type="button">
        <Plus aria-hidden="true" />
        <span>Add to My Day</span>
      </button>
      <p aria-live="polite" role="status">{message}</p>
    </aside>
  );
}
