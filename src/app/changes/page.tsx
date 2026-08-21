import type { Metadata } from "next";
import { ArrowRight, History, TrendingUp } from "lucide-react";

import { EmptyState, PageFrame } from "@/components/pulserank/public-ui";
import { listChanges } from "@/server/products/queries";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Changes",
  description: "Trusted source-to-source product changes and their timestamps.",
};

export default async function ChangesPage() {
  const changes = await listChanges({ limit: 40 });
  return <PageFrame active="/changes" eyebrow="Trusted history · no fabricated trend lines" title="See what changed." description="This timeline is built only from trusted-to-trusted observations. When there is no history, PulseRank says so instead of drawing a story."><div className="pr-changes-layout"><aside className="pr-rail"><h2>Change stream</h2><div className="pr-rail-item"><History size={15} /> Trusted observations</div><div className="pr-rail-item"><TrendingUp size={15} /> Rank effects</div><div className="pr-rail-item"><span className="pr-status-light" /> Source timestamps</div></aside><section>{changes.items.length > 0 ? changes.items.map((change) => <article className="pr-change-card" key={change.id}><time className="pr-change-time" dateTime={change.occurredAt}>{new Date(change.occurredAt).toLocaleString()}</time><div><h2>{change.productName}</h2><p>{change.eventType.replaceAll("_", " ")} was observed in the trusted source history.</p><a href={`/products/${change.slug}`}>Open product passport <ArrowRight size={13} /></a></div></article>) : <EmptyState title="No trusted changes recorded" description="A change event appears only when a later trusted observation differs from the previous trusted record. Candidate, quarantined, and failed runs never enter this timeline." />}</section></div></PageFrame>;
}
