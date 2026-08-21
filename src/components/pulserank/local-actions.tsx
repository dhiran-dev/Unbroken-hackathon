"use client";

import { useEffect, useMemo, useState } from "react";
import { Bookmark, Check, GitCompareArrows, Plus } from "lucide-react";

import type { PublicProductDto } from "@/server/products/dto";
import { addMyDayEntry } from "@/lib/local-state/my-day";
import { addCompareSlug, isInCompare, removeCompareSlug } from "@/lib/local-state/compare";
import {
  isProductSaved,
  removeSavedProduct,
  saveSavedProduct,
  type SavedProductRef,
} from "@/lib/local-state/saved-products";

function toSavedRef(product: PublicProductDto): SavedProductRef | null {
  if (product.caffeine.mg === null || product.serving.value === null) return null;
  return {
    slug: product.slug,
    name: product.name,
    category: product.category,
    caffeine: {
      mg: product.caffeine.mg,
      qualifier: product.caffeine.qualifier,
      sourceLevel: product.caffeine.sourceLevel,
    },
    serving: {
      value: product.serving.value,
      unit: product.serving.unit ?? "unknown",
      form: product.serving.form,
    },
    observedAt: product.observedAt,
  };
}
export function LocalProductActionsClient({
  product,
  compact = false,
}: {
  product: PublicProductDto;
  compact?: boolean;
}) {
  const savedRef = useMemo(() => toSavedRef(product), [product]);
  const [saved, setSaved] = useState(false);
  const [compared, setCompared] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([
      isProductSaved(product.slug),
      Promise.resolve(isInCompare(product.slug)),
    ]).then(([nextSaved, nextCompared]) => {
      if (!active) return;
      setSaved(nextSaved);
      setCompared(nextCompared);
    });
    return () => { active = false; };
  }, [product.slug]);

  async function toggleSaved() {
    if (!savedRef) {
      setMessage("This record has no exact point value and cannot be saved as a numeric snapshot.");
      return;
    }
    if (saved) {
      await removeSavedProduct(product.slug);
      setSaved(false);
      setMessage("Removed from this browser");
    } else {
      await saveSavedProduct(savedRef);
      setSaved(true);
      setMessage("Saved to this browser");
    }
  }

  function toggleCompare() {
    const update = compared ? removeCompareSlug(product.slug) : addCompareSlug(product.slug);
    setCompared(update.slugs.includes(product.slug));
    setMessage(update.added || compared ? (compared ? "Removed from compare" : "Added to compare") : "Compare tray is full (4 max)");
  }

  async function addToDay() {
    if (!savedRef) {
      setMessage("My Day needs an exact numeric caffeine value.");
      return;
    }
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const timeLabel = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
    await addMyDayEntry(date, { slug: product.slug, name: product.name, timeLabel, caffeineMg: savedRef.caffeine.mg });
    setMessage("Added to My Day");
  }

  return (
    <div className="pr-local-actions" aria-live="polite">
      <div className="pr-local-action-row">
        <button type="button" className={`pr-button pr-button-ghost${saved ? " is-selected" : ""}`} onClick={() => void toggleSaved()} title={savedRef ? "Save in this browser" : "Exact numeric value required to save"}>
          {saved ? <Check size={15} aria-hidden="true" /> : <Bookmark size={15} aria-hidden="true" />}
          {!compact ? (saved ? "Saved" : "Save") : null}
        </button>
        <button type="button" className={`pr-button pr-button-ghost${compared ? " is-selected" : ""}`} onClick={toggleCompare} title="Compare up to four products locally">
          <GitCompareArrows size={15} aria-hidden="true" />
          {!compact ? (compared ? "In compare" : "Compare") : null}
        </button>
        {!compact ? <button type="button" className="pr-button pr-button-ghost" onClick={() => void addToDay()}><Plus size={15} aria-hidden="true" /> My Day</button> : null}
      </div>
      {message ? <span className="pr-action-message">{message}</span> : null}
    </div>
  );
}
