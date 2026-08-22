import type { Metadata } from "next";
import { Activity, AlertTriangle, Database, Radio, ShieldCheck } from "lucide-react";

import { CoverageBar, EmptyState, PageFrame } from "@/components/pulserank/public-ui";
import { OptionalVisualStage } from "@/components/pulserank/visual-stage/optional-stage";
import { getLiveDataStats } from "@/server/products/queries";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Live Data",
  description: "Operational PulseRank counts, collector state, and trust-pipeline history.",
};

export default async function LiveDataPage() {
  const stats = await getLiveDataStats();
  const total = Object.values(stats.observationCounts).reduce((sum, value) => sum + value, 0);
  const last = stats.lastCollectionRun;

  return (
    <PageFrame
      active="/live-data"
      eyebrow="Operations / public counters"
      title="See the pipeline."
      description="Real database counts and collector history, with no arbitrary confidence score. Candidates and quarantined observations never become public products until promotion says they can."
    >
      <OptionalVisualStage page="live-data" variant="live-data" className="pr-route-stage pr-live-stage" />
      <div className="pr-live-layout">
        <aside className="pr-rail">
          <h2>Pipeline</h2>
          <div className="pr-rail-item"><Radio size={15} /> Collector runs</div>
          <div className="pr-rail-item"><Database size={15} /> Raw landing</div>
          <div className="pr-rail-item"><ShieldCheck size={15} /> Trust promotion</div>
          <div className="pr-rail-item"><Activity size={15} /> Board rebuilds</div>
        </aside>
        <section>
          <div className="pr-live-counters">
            <div className="pr-live-counter"><span>Trusted</span><strong>{stats.observationCounts.trusted}</strong><small>public observations</small></div>
            <div className="pr-live-counter"><span>Candidate</span><strong>{stats.observationCounts.candidate}</strong><small>awaiting promotion</small></div>
            <div className="pr-live-counter"><span>Quarantined</span><strong>{stats.observationCounts.quarantined}</strong><small>held for review</small></div>
            <div className="pr-live-counter"><span>Open incidents</span><strong>{stats.openIncidentCount}</strong><small>operator attention</small></div>
          </div>
          <div className="pr-live-panels">
            <section className="pr-panel">
              <div className="pr-panel-heading">
                <div><p className="pr-eyebrow">Collector health</p><h2>Last attempt</h2></div>
                {last?.status === "succeeded" ? <ShieldCheck color="var(--pr-green)" size={18} /> : <AlertTriangle color="var(--pr-amber)" size={18} />}
              </div>
              {last ? (
                <div className="pr-pipeline-list">
                  <div className="pr-pipeline-row"><span>Status</span><b>{last.status}</b></div>
                  <div className="pr-pipeline-row"><span>Trigger</span><b>{last.trigger}</b></div>
                  <div className="pr-pipeline-row"><span>Rows landed</span><b>{last.rowCount ?? "—"}</b></div>
                  <div className="pr-pipeline-row"><span>Error code</span><b>{last.errorCode ?? "none"}</b></div>
                  <div className="pr-pipeline-row"><span>At</span><b>{last.at ? new Date(last.at).toLocaleString() : "—"}</b></div>
                </div>
              ) : <EmptyState title="No collection run recorded" description="The pulse schema has no collection history yet." action="Return home" href="/" />}
            </section>
            <section className="pr-panel">
              <div className="pr-panel-heading"><div><p className="pr-eyebrow">Field coverage</p><h2>What is observed</h2></div></div>
              <CoverageBar label="Trusted observations" value={stats.observationCounts.trusted} total={Math.max(total, stats.observationCounts.trusted)} />
              <div className="pr-pipeline-list">
                <div className="pr-pipeline-row"><span>Schema version</span><b>{stats.schemaVersion}</b></div>
                <div className="pr-pipeline-row"><span>Last collection</span><b>{stats.lastCollectionRunAt ? new Date(stats.lastCollectionRunAt).toLocaleString() : "—"}</b></div>
              </div>
            </section>
          </div>
          <section className="pr-panel" style={{ marginTop: "14px" }}>
            <div className="pr-panel-heading"><div><p className="pr-eyebrow">Registered source</p><h2>Caffeine Informer</h2></div></div>
            {stats.activeCollectors.map((collector) => <div className="pr-pipeline-row" key={collector.externalId}><span>{collector.source} · active collector</span><span className="pr-collector-id">{collector.externalId}</span></div>)}
            {stats.activeCollectors.length === 0 ? <p className="pr-muted-copy">No active collector is registered.</p> : null}
            <p className="pr-muted-copy">The page shows source identity, not a confidence score. Bright Data output enters the isolated pulse schema before any deterministic contract or promotion decision.</p>
          </section>
        </section>
      </div>
    </PageFrame>
  );
}
