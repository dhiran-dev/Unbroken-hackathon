"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Download, Link2, RefreshCw, Trash2, Upload } from "lucide-react";

import type { PublicProductDto } from "@/server/products/dto";
import { getCompareSlugs, removeCompareSlug, addCompareSlug } from "@/lib/local-state/compare";
import { exportAll, importAll } from "@/lib/local-state/export-import";
import { listMyDayRecordsForDate, type MyDayRecord } from "@/lib/local-state/my-day";
import { listRecentlyViewed, type RecentlyViewedRecord, touchRecentlyViewed } from "@/lib/local-state/recently-viewed";
import { listSavedProducts, type StoredSavedProduct } from "@/lib/local-state/saved-products";
import { categoryLabel, caffeineText, FieldStateBadge, ProductArt, servingText } from "@/components/pulserank/public-ui";

function savedRef(product: PublicProductDto) {
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
    serving: { value: product.serving.value, unit: product.serving.unit ?? "unknown", form: product.serving.form },
    observedAt: product.observedAt,
  } as const;
}

export function ProductViewTracker({ product }: { product: PublicProductDto }) {
  useEffect(() => {
    const ref = savedRef(product);
    if (ref) void touchRecentlyViewed(product.slug, ref);
  }, [product]);
  return null;
}

type ProductResponse = { product?: PublicProductDto };

export function CompareWorkspace() {
  const [slugs, setSlugs] = useState<string[]>([]);
  const [products, setProducts] = useState<PublicProductDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  async function reload(nextSlugs = getCompareSlugs()) {
    setSlugs(nextSlugs);
    setLoading(true);
    const loaded = await Promise.all(nextSlugs.map(async (slug) => {
      try {
        const response = await fetch(`/api/public/products/${encodeURIComponent(slug)}`, { cache: "no-store" });
        if (!response.ok) return null;
        const body = (await response.json()) as ProductResponse;
        return body.product ?? null;
      } catch {
        return null;
      }
    }));
    setProducts(loaded.filter((item): item is PublicProductDto => item !== null));
    setLoading(false);
  }

  useEffect(() => {
    const add = new URLSearchParams(window.location.search).get("add");
    const next = add ? addCompareSlug(add).slugs : getCompareSlugs();
    // Browser storage is an external system; hydrate after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload(next);
  }, []);

  function remove(slug: string) {
    const next = removeCompareSlug(slug).slugs;
    void reload(next);
  }

  async function copyShareLink() {
    const url = `${window.location.origin}/compare?products=${encodeURIComponent(slugs.join(","))}`;
    try {
      await navigator.clipboard.writeText(url);
      setMessage("Share link copied");
    } catch {
      setMessage(url);
    }
  }

  if (loading) return <div className="pr-loading">Loading your local compare tray…</div>;
  if (products.length === 0) {
    return <div className="pr-empty-state"><div className="pr-empty-icon"><Link2 size={20} aria-hidden="true" /></div><p className="pr-eyebrow">Four-slot local tray</p><h2>Nothing selected yet</h2><p>Choose Compare on any trusted product. Your selection stays in this browser.</p><a className="pr-button pr-button-primary" href="/explore">Explore products</a></div>;
  }

  return (
    <div className="pr-compare-workspace">
      <div className="pr-workspace-toolbar"><span>{products.length} of 4 slots used</span><div><button type="button" className="pr-button pr-button-ghost" onClick={() => void reload()}><RefreshCw size={14} aria-hidden="true" /> Refresh</button><button type="button" className="pr-button pr-button-ghost" onClick={() => void copyShareLink()}><Link2 size={14} aria-hidden="true" /> Share</button></div></div>
      {message ? <p className="pr-action-message">{message}</p> : null}
      <div className="pr-compare-cards">{products.map((product) => <article className="pr-compare-card" key={product.slug}><button type="button" className="pr-remove" onClick={() => remove(product.slug)} aria-label={`Remove ${product.name}`}><Trash2 size={14} /></button><ProductArt category={product.category} name={product.name} /><p className="pr-category-label">{categoryLabel(product.category)}</p><h3>{product.name}</h3><strong>{caffeineText(product.caffeine)}</strong></article>)}</div>
      <div className="pr-table-wrap"><table className="pr-data-table pr-compare-table"><thead><tr><th>Exact field</th>{products.map((product) => <th key={product.slug}>{product.name}</th>)}</tr></thead><tbody>
        <CompareRow label="Caffeine" products={products} value={(p) => caffeineText(p.caffeine)} state={(p) => p.caffeine.state} />
        <CompareRow label="Qualifier" products={products} value={(p) => p.caffeine.qualifier} />
        <CompareRow label="Serving" products={products} value={(p) => servingText(p)} state={(p) => p.serving.state} />
        <CompareRow label="Concentration" products={products} value={(p) => p.concentration.mgPer100Ml === null ? "Not eligible" : `${p.concentration.mgPer100Ml} mg / 100 ml`} />
        <CompareRow label="Observed" products={products} value={(p) => new Date(p.observedAt).toLocaleDateString()} />
      </tbody></table></div>
      <p className="pr-legend"><span className="legend-dot is-present" /> Observed <span className="legend-dot is-missing" /> Not published <span className="legend-dot is-warning" /> Conflicting or needs review</p>
    </div>
  );
}

function CompareRow({ label, products, value, state }: { label: string; products: PublicProductDto[]; value: (product: PublicProductDto) => string; state?: (product: PublicProductDto) => string }) {
  return <tr><th>{label}</th>{products.map((product) => <td key={product.slug}><strong>{value(product)}</strong>{state ? <FieldStateBadge state={state(product)} /> : null}</td>)}</tr>;
}

export function MyPulseWorkspace() {
  const [saved, setSaved] = useState<StoredSavedProduct[]>([]);
  const [recent, setRecent] = useState<RecentlyViewedRecord[]>([]);
  const [day, setDay] = useState<MyDayRecord[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  async function reload() {
    const [savedProducts, recentlyViewed, myDay] = await Promise.all([listSavedProducts(), listRecentlyViewed(8), listMyDayRecordsForDate(today)]);
    setSaved(savedProducts);
    setRecent(recentlyViewed);
    setDay(myDay);
  }

  useEffect(() => {
    // Browser storage is an external system; hydrate after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today]);

  async function downloadBackup() {
    const envelope = await exportAll();
    const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `pulserank-local-${today}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setMessage("Local backup downloaded");
  }

  async function importBackup(file: File) {
    try {
      const summary = await importAll(JSON.parse(await file.text()));
      setMessage(`Imported ${summary.savedProducts} saved products and ${summary.myDay} My Day entries`);
      await reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Import failed");
    }
  }

  const totalToday = day.reduce((sum, entry) => sum + entry.caffeineMg, 0);
  return (
    <div className="pr-my-pulse-workspace">
      <div className="pr-local-status"><span className="pr-status-light" /> <strong>Local mode</strong><span>Nothing here is uploaded or tied to an account.</span><button type="button" className="pr-button pr-button-ghost" onClick={() => void reload()}><RefreshCw size={14} aria-hidden="true" /> Refresh</button></div>
      <div className="pr-my-day-card"><div><p className="pr-eyebrow">My Day · {today}</p><h2>{totalToday.toLocaleString()} <small>mg caffeine logged</small></h2></div><div className="pr-day-bars">{[0, 1, 2, 3, 4, 5, 6].map((bar) => <span key={bar} style={{ height: `${Math.max(12, Math.min(100, totalToday ? (day.length * 14 + bar * 4) : 12))}%` }} />)}</div></div>
      <div className="pr-my-pulse-grid"><section className="pr-panel"><div className="pr-panel-heading"><div><p className="pr-eyebrow">Saved products</p><h2>{saved.length} saved</h2></div></div>{saved.length === 0 ? <p className="pr-muted-copy">Save an exact numeric product to build a personal shelf.</p> : <div className="pr-local-list">{saved.slice(0, 6).map((item) => <Link key={item.slug} href={`/products/${item.slug}`} className="pr-local-list-item"><span><strong>{item.name}</strong><small>{categoryLabel(item.category)}</small></span><b>{item.caffeine.mg} mg</b></Link>)}</div>}</section><section className="pr-panel"><div className="pr-panel-heading"><div><p className="pr-eyebrow">Recently viewed</p><h2>{recent.length} recent</h2></div></div>{recent.length === 0 ? <p className="pr-muted-copy">Product pages you open with an exact numeric record appear here.</p> : <div className="pr-local-list">{recent.slice(0, 6).map((item) => <Link key={item.slug} href={`/products/${item.slug}`} className="pr-local-list-item"><span><strong>{item.ref.name}</strong><small>{categoryLabel(item.ref.category)}</small></span><b>{item.ref.caffeine.mg} mg</b></Link>)}</div>}</section></div>
      <section className="pr-panel"><div className="pr-panel-heading"><div><p className="pr-eyebrow">Storage & transfer</p><h2>Keep your pulse portable</h2></div><div className="pr-local-transfer"><button type="button" className="pr-button pr-button-primary" onClick={() => void downloadBackup()}><Download size={14} aria-hidden="true" /> Export</button><label className="pr-button pr-button-ghost"><Upload size={14} aria-hidden="true" /> Import<input type="file" accept="application/json" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void importBackup(file); }} /></label></div></div><p className="pr-muted-copy">Saved products, compare tray, My Day, recent history, and preferences are stored locally with a versioned import/export envelope.</p>{message ? <p className="pr-action-message">{message}</p> : null}</section>
    </div>
  );
}
