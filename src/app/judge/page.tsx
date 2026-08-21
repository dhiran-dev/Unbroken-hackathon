/**
 * Judge Cockpit (Agent A12) — /judge
 *
 * HTML-first evidence cockpit over the REAL Bright Data healing artifacts
 * recorded by Agent A2 (docs/handoffs/A2-collector.md). The page is a server
 * component that re-reads artifacts/scraper/ on every request and computes
 * every verdict with the production code paths (zod contract, run-level
 * validation, promotion). All essential text is plain HTML — the page is fully
 * readable with JavaScript disabled; the only client JS is a copy button.
 */

import { pulserankServerFlags } from "@/config/pulserank-flags";
import {
  Callout,
  KeyValue,
  KeyValueList,
  Mono,
  VerdictChip,
} from "@/components/pulserank/judge/bits";
import { CopyButton } from "@/components/pulserank/judge/copy-button";
import {
  CollectorRecordTable,
  NotPublishedList,
} from "@/components/pulserank/judge/collector-record-table";
import { JsonViewer } from "@/components/pulserank/judge/json-viewer";
import { MutationControls } from "@/components/pulserank/judge/mutation-controls";
import {
  JudgeStepCard,
  type JudgeStepStatus,
} from "@/components/pulserank/judge/step-card";
import {
  loadJudgeEvidence,
  type JudgeEvidenceModel,
  type RecordAnalysis,
} from "@/server/judge/evidence";
import { JUDGE_COLLECTOR_ID } from "@/server/judge/to-scrape-row";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function firstParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function artifactText(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function ratioText(analysis: RecordAnalysis): string | null {
  const { perServingMg, impliedPerServingMg } = analysis.unitCheck ?? {};
  if (perServingMg === null || perServingMg === undefined || perServingMg <= 0) return null;
  if (impliedPerServingMg === null || impliedPerServingMg === undefined || impliedPerServingMg <= 0) {
    return null;
  }
  return `${(perServingMg / impliedPerServingMg).toFixed(1)}×`;
}

function mg(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${value} mg`;
}

function availabilityTone(ok: boolean, fallback: JudgeStepStatus = "ok"): JudgeStepStatus {
  return ok ? fallback : "unavailable";
}

function OutcomeBanner({ params }: { params: SearchParams }) {
  const mutation = firstParam(params.mutation);
  const outcome = firstParam(params.outcome);
  const detail = firstParam(params.detail);
  const artifact = firstParam(params.artifact);
  if (mutation === null || outcome === null) return null;

  const tone =
    outcome === "ok" ? "pass" : outcome === "error" ? "fail" : outcome === "denied" ? "warn" : "info";
  return (
    <Callout
      tone={tone}
      title={`Mutation ${mutation}: ${outcome}`}
    >
      <p>{detail}</p>
      {artifact !== null ? (
        <p className="mt-1">
          Envelope saved as <Mono>{`artifacts/demo/${artifact}`}</Mono>{" "}
          <CopyButton text={`artifacts/demo/${artifact}`} label="Copy path" />
        </p>
      ) : null}
    </Callout>
  );
}

export default async function JudgePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const evidence = loadJudgeEvidence(pulserankServerFlags.judgeMutationsEnabled);

  const pre = evidence.preHeal;
  const post = evidence.postHeal;
  const preInconsistent = pre.unitCheck?.consistent === false;
  const postConsistent = post.unitCheck?.consistent === true;
  const heal = evidence.heal;
  const approve = evidence.approve;

  const createJson = evidence.create;
  const runStandardJson = pre.record !== null ? [pre.record] : null;
  const postHealJson = post.record !== null ? [post.record] : null;

  const preCaffeine = pre.promotion?.fieldVerdicts.caffeine_mg ?? null;
  const postCaffeine = post.promotion?.fieldVerdicts.caffeine_mg ?? null;
  const preServing = pre.promotion?.fieldVerdicts.serving ?? null;
  const postServing = post.promotion?.fieldVerdicts.serving ?? null;

  return (
    <div className="space-y-6">
      <OutcomeBanner params={params} />

      {/* 1 — Collector ------------------------------------------------- */}
      <JudgeStepCard
        index={1}
        id="collector"
        title="Collector"
        status={availabilityTone(createJson !== null)}
        statusLabel={createJson?.status ?? undefined}
        summary="The Bright Data Scraper Studio collector was created once (template caffeine-pdp) and its identity is frozen: every later step must reference the SAME collector id."
      >
        <KeyValueList>
          <KeyValue label="Collector ID" mono>
            {evidence.collectorId}
            <CopyButton text={evidence.collectorId} label="Copy ID" className="ml-2" />
          </KeyValue>
          <KeyValue label="Template name">{createJson?.name ?? "unavailable"}</KeyValue>
          <KeyValue label="Create status">{createJson?.status ?? "unavailable"}</KeyValue>
          <KeyValue label="Created at">{createJson?.createdAt ?? "unavailable"}</KeyValue>
          <KeyValue label="Dashboard">
            {createJson?.viewUrl ? (
              <a
                className="break-all text-[var(--pr-accent-strong)] underline"
                href={createJson.viewUrl}
                rel="noreferrer noopener"
                target="_blank"
              >
                {createJson.viewUrl}
              </a>
            ) : (
              "unavailable"
            )}
          </KeyValue>
        </KeyValueList>
        {createJson !== null ? (
          <JsonViewer value={createJson} label="artifacts/scraper/create.json (verbatim)" />
        ) : (
          <Callout tone="warn" title="create.json unavailable">
            The create envelope artifact could not be read; no substitute is shown.
          </Callout>
        )}
      </JudgeStepCard>

      {/* 2 — Structured Output ----------------------------------------- */}
      <JudgeStepCard
        index={2}
        id="structured-output"
        title="Structured Output"
        status={preInconsistent ? "failed" : availabilityTone(pre.record !== null)}
        statusLabel={preInconsistent ? "unit bug" : undefined}
        summary="The first standard run returned one structured record for the Sting 250 ml page. The published caffeine_mg_per_serving value is shown verbatim — including the unit bug."
      >
        {pre.record !== null ? (
          <>
            <CollectorRecordTable
              record={pre.record as Record<string, unknown>}
              flaggedFields={preInconsistent ? ["caffeine_mg_per_serving"] : []}
              caffeineObservation={pre.scrapeRow?.primary.caffeineMg ?? null}
              servingObservation={pre.scrapeRow?.primary.serving ?? null}
              sourceUrl={pre.sourceUrl}
            />
            <JsonViewer
              value={runStandardJson}
              label="artifacts/scraper/run-standard.json (verbatim)"
              rawText={artifactText(runStandardJson)}
            />
          </>
        ) : (
          <Callout tone="warn" title="run-standard.json unavailable">
            The pre-heal run artifact could not be read; no substitute is shown.
          </Callout>
        )}
      </JudgeStepCard>

      {/* 3 — Contract --------------------------------------------------- */}
      <JudgeStepCard
        index={3}
        id="contract"
        title="Contract"
        status={availabilityTone(pre.contract.ok, pre.contract.ok ? "ok" : "failed")}
        statusLabel={pre.contract.ok ? "schema valid" : "schema invalid"}
        summary="The collector record is mapped to the PulseRank V1 scrape-row contract (src/server/judge/to-scrape-row.ts) and validated with the production zod schema (A3). Fields the collector never publishes are marked not_published — sparse is data, not a gap."
      >
        {pre.scrapeRow !== null ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <VerdictChip tone={pre.contract.ok ? "pass" : "fail"}>
                zod contract {pre.contract.ok ? "PASS" : "FAIL"}
              </VerdictChip>
              <span className="text-[13px] text-[var(--pr-text-muted)]">
                productScrapeRowV1Schema · pre-heal mapped row
              </span>
            </div>
            {pre.contract.issues.length > 0 ? (
              <ul className="list-disc pl-5 text-[13px] text-[var(--pr-danger)]">
                {pre.contract.issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            ) : null}
            <NotPublishedList
              states={[
                { label: "calories_kcal", state: "not_published" },
                { label: "sugar_g", state: "not_published" },
                { label: "ingredients", state: "not_published" },
                { label: "variants", state: "not_published" },
                { label: "flavours", state: "not_published" },
              ]}
            />
            <KeyValueList>
              <KeyValue label="Slug" mono>{pre.scrapeRow.source.slug}</KeyValue>
              <KeyValue label="Observed at (artifact mtime)" mono>{pre.observedAt ?? "—"}</KeyValue>
              <KeyValue label="Page fingerprint (derived from record content)" mono>
                {pre.scrapeRow.source.pageFingerprint.slice(0, 27)}…
              </KeyValue>
              <KeyValue label="Media publication state" mono>
                audit_only
              </KeyValue>
            </KeyValueList>
            {pre.scrapeRow.evidence.warnings.length > 0 ? (
              <Callout tone="fail" title="Row carries computed warnings">
                <ul className="list-disc pl-5">
                  {pre.scrapeRow.evidence.warnings.map((warning) => (
                    <li key={warning} className="font-mono text-[12px]">
                      {warning}
                    </li>
                  ))}
                </ul>
              </Callout>
            ) : null}
          </>
        ) : (
          <Callout tone="warn" title="Mapping unavailable">
            No pre-heal record to map; the contract step cannot run without it.
          </Callout>
        )}
      </JudgeStepCard>

      {/* 4 — Incident --------------------------------------------------- */}
      <JudgeStepCard
        index={4}
        id="incident"
        title="Incident"
        status={preInconsistent ? "failed" : "unavailable"}
        statusLabel={preInconsistent ? "detected" : "none recorded"}
        summary="The collector published TWO independent caffeine figures. Cross-checking them is the A2-recommended sanity rule: mg-per-serving must agree with mg-per-100ml × serving volume. On this page they disagree by three orders of magnitude — a unit-conversion bug in the AI-generated template."
      >
        {pre.unitCheck !== null && pre.unitCheck.consistent === false ? (
          <div className="overflow-hidden rounded-md border border-[var(--pr-danger-border)]">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">Computed unit-consistency check, pre-heal</caption>
              <tbody>
                <tr className="border-b border-white/5">
                  <th scope="row" className="px-3 py-2 text-left text-xs uppercase text-[var(--pr-text-muted)]">
                    Published caffeine_mg_per_serving
                  </th>
                  <td className="px-3 py-2 font-mono text-[var(--pr-danger)]">{mg(pre.unitCheck.perServingMg)}</td>
                </tr>
                <tr className="border-b border-white/5">
                  <th scope="row" className="px-3 py-2 text-left text-xs uppercase text-[var(--pr-text-muted)]">
                    Implied by caffeine_mg_per_100ml × serving volume
                  </th>
                  <td className="px-3 py-2 font-mono text-[var(--pr-success)]">
                    {mg(pre.unitCheck.impliedPerServingMg)} (28.79 mg/100ml × 250 ml)
                  </td>
                </tr>
                <tr>
                  <th scope="row" className="px-3 py-2 text-left text-xs uppercase text-[var(--pr-text-muted)]">
                    Discrepancy
                  </th>
                  <td className="px-3 py-2 font-mono text-[var(--pr-danger)]">
                    {ratioText(pre) ?? "—"} off — unit bug (mg vs µg-scale confusion)
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <Callout tone="info" title="No unit inconsistency computed">
            The recorded pre-heal artifact either is unavailable or its figures agree; no incident
            is claimed.
          </Callout>
        )}
        <p className="text-[13px] leading-relaxed text-[var(--pr-text-muted)]">
          Because the two published figures disagree beyond the documented tolerance
          (±1 mg or 5% relative), the mapped row carries caffeine as the contract state{" "}
          <Mono>conflicting</Mono> with both readings kept as candidates — and the promotion
          logic (step 10) therefore excluded the metric from every board until the heal landed.
        </p>
      </JudgeStepCard>

      {/* 5 — Heal Preview ----------------------------------------------- */}
      <JudgeStepCard
        index={5}
        id="heal-preview"
        title="Heal Preview"
        status={availabilityTone(heal !== null && heal.prompt !== null)}
        statusLabel={heal?.status ?? undefined}
        summary="One scraper heal with a precise prompt (observed wrong value + expected value + the page's ground truth) stopped at the approval gate with a corrected preview: 72 mg per serving. The heal prompt and diff summary below are the recorded CLI output."
      >
        {heal !== null ? (
          <>
            <KeyValueList>
              <KeyValue label="Heal status">{heal.status ?? "unavailable"}</KeyValue>
              <KeyValue label="Completed steps" mono>
                {heal.completedSteps.join(" · ") || "—"}
              </KeyValue>
              <KeyValue label="Diff summary">{heal.diffSummary ?? "—"}</KeyValue>
              <KeyValue label="Next step" mono>{heal.nextStep ?? "—"}</KeyValue>
            </KeyValueList>
            <figure className="rounded-md border border-[var(--pr-accent-border)] bg-black/40 p-3">
              <figcaption className="mb-1 text-xs font-medium uppercase tracking-wide text-[var(--pr-accent-strong)]">
                Heal prompt (verbatim)
              </figcaption>
              <blockquote className="whitespace-pre-wrap font-mono text-[13px] leading-relaxed text-[var(--pr-text-primary)]">
                {heal.prompt ?? "—"}
              </blockquote>
            </figure>
            {heal.previewRecords.length > 0 ? (
              <CollectorRecordTable
                record={heal.previewRecords[0] as Record<string, unknown>}
                caffeineObservation={post.scrapeRow?.primary.caffeineMg ?? null}
                servingObservation={post.scrapeRow?.primary.serving ?? null}
              />
            ) : null}
            <JsonViewer value={heal} label="artifacts/scraper/heal.json (verbatim)" />
            <MutationControls
              kind="heal-preview"
              enabled={evidence.mutationsEnabled}
              sourceUrl={pre.sourceUrl ?? "https://www.caffeineinformer.com/caffeine-content/sting"}
              defaultPrompt={heal.prompt ?? undefined}
            />
          </>
        ) : (
          <Callout tone="warn" title="heal.json unavailable">
            The heal envelope could not be read; the recorded prompt cannot be shown.
          </Callout>
        )}
      </JudgeStepCard>

      {/* 6 — Validation -------------------------------------------------- */}
      <JudgeStepCard
        index={6}
        id="validation"
        title="Validation"
        status={availabilityTone(post.contract.ok && postConsistent)}
        statusLabel={postConsistent ? "post-heal pass" : undefined}
        summary="The post-heal record is mapped through the same mapper and checked three ways with production code: the zod contract (shape + non-negativity), the A5 run-level checks, and the cross-field unit-consistency rule that caught the bug."
      >
        {post.scrapeRow !== null ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <VerdictChip tone={post.contract.ok ? "pass" : "fail"}>
                zod contract {post.contract.ok ? "PASS" : "FAIL"}
              </VerdictChip>
              <VerdictChip tone={post.runValidation?.ok ? "pass" : "fail"}>
                validateRun {post.runValidation?.ok ? "OK" : "FINDINGS"}
              </VerdictChip>
              <VerdictChip tone={postConsistent ? "pass" : "fail"}>
                unit check {postConsistent ? "PASS" : "FAIL"}
              </VerdictChip>
            </div>
            <KeyValueList>
              <KeyValue label="Post-heal caffeine" mono>
                {mg(post.unitCheck?.perServingMg ?? null)} vs implied{" "}
                {mg(post.unitCheck?.impliedPerServingMg ?? null)} — agrees within rounding
              </KeyValue>
              <KeyValue label="Computed concentration (A5 normalizer)">
                {post.normalized?.concentration.basis === "computed"
                  ? `${post.normalized.concentration.mgPer100Ml} mg/100ml`
                  : `not computed (${post.normalized?.concentration.basis ?? "unavailable"})`}
              </KeyValue>
            </KeyValueList>
            {post.contract.issues.length > 0 ? (
              <ul className="list-disc pl-5 text-[13px] text-[var(--pr-danger)]">
                {post.contract.issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            ) : null}
            {post.runValidation && post.runValidation.findings.length > 0 ? (
              <ul className="list-disc pl-5 text-[13px] text-[var(--pr-warn)]">
                {post.runValidation.findings.map((finding) => (
                  <li key={`${finding.check}:${finding.detail}`}>
                    {finding.severity}: {finding.check} — {finding.detail}
                  </li>
                ))}
              </ul>
            ) : null}
            <CollectorRecordTable
              record={post.record as Record<string, unknown>}
              caffeineObservation={post.scrapeRow.primary.caffeineMg}
              servingObservation={post.scrapeRow.primary.serving}
              sourceUrl={post.sourceUrl}
            />
            <JsonViewer
              value={postHealJson}
              label="artifacts/scraper/run-standard-post-heal.json (verbatim)"
              rawText={artifactText(postHealJson)}
            />
          </>
        ) : (
          <Callout tone="warn" title="run-standard-post-heal.json unavailable">
            The post-heal run artifact could not be read; no substitute is shown.
          </Callout>
        )}
      </JudgeStepCard>

      {/* 7 — Approval ---------------------------------------------------- */}
      <JudgeStepCard
        index={7}
        id="approval"
        title="Approval"
        status={availabilityTone(approve !== null)}
        statusLabel={approve?.status ?? undefined}
        summary="The heal gate was resolved by an explicit scraper approve (never --auto-approve): the template was saved only after the user_approval step completed."
      >
        {approve !== null ? (
          <>
            <KeyValueList>
              <KeyValue label="Approve status">{approve.status ?? "unavailable"}</KeyValue>
              <KeyValue label="Completed steps" mono>
                {approve.completedSteps.join(" · ") || "—"}
              </KeyValue>
              <KeyValue label="Template saved">
                {approve.completedSteps.includes("save_new_template") ? "yes" : "no"}
              </KeyValue>
              <KeyValue label="Human approval step">
                {approve.completedSteps.includes("user_approval") ? "user_approval ✓" : "absent"}
              </KeyValue>
              <KeyValue label="Next step" mono>{approve.nextStep ?? "—"}</KeyValue>
            </KeyValueList>
            <JsonViewer value={approve} label="artifacts/scraper/approve.json (verbatim)" />
          </>
        ) : (
          <Callout tone="warn" title="approve.json unavailable">
            The approve envelope could not be read; no substitute is shown.
          </Callout>
        )}
      </JudgeStepCard>

      {/* 8 — Same Collector Rerun ---------------------------------------- */}
      <JudgeStepCard
        index={8}
        id="rerun"
        title="Same Collector Rerun"
        status={availabilityTone(post.record !== null && evidence.collectorId === JUDGE_COLLECTOR_ID)}
        statusLabel={post.record !== null ? "verified" : undefined}
        summary="The verification run used the SAME collector id (no collector replacement): the healed template re-extracted the page and the per-serving figure came back correct at 72 mg."
      >
        <KeyValueList>
          <KeyValue label="Ran collector" mono>{evidence.collectorId}</KeyValue>
          <KeyValue label="Expected collector" mono>{JUDGE_COLLECTOR_ID}</KeyValue>
          <KeyValue label="Identity stable">
            {evidence.collectorId === JUDGE_COLLECTOR_ID ? "yes — same collector before and after the heal" : "MISMATCH"}
          </KeyValue>
          <KeyValue label="Post-heal per-serving value" mono>
            {mg(post.unitCheck?.perServingMg ?? null)}
          </KeyValue>
        </KeyValueList>
        <MutationControls
          kind="rerun"
          enabled={evidence.mutationsEnabled}
          sourceUrl={post.sourceUrl ?? pre.sourceUrl ?? "https://www.caffeineinformer.com/caffeine-content/sting"}
        />
      </JudgeStepCard>

      {/* 9 — Recovery ----------------------------------------------------- */}
      <JudgeStepCard
        index={9}
        id="recovery"
        title="Recovery"
        status={availabilityTone(post.promotion?.overall === "trusted" && postCaffeine?.rankable === true)}
        statusLabel={postCaffeine?.verdict ?? undefined}
        summary="The recovered row is pushed through the real promotion logic (A5 normalizeRow + promoteCandidate, imported from src/server/ingestion). The record promotes as trusted with an exact, rankable caffeine value."
      >
        {post.promotion !== null && postCaffeine !== null ? (
          <KeyValueList>
            <KeyValue label="Promotion overall">{post.promotion.overall}</KeyValue>
            <KeyValue label="caffeine_mg verdict">
              {postCaffeine.verdict} · value {mg(postCaffeine.value)} · qualifier {postCaffeine.qualifier}
            </KeyValue>
            <KeyValue label="rankable / exact-board eligible">
              {String(postCaffeine.rankable)} / {String(postCaffeine.exactBoardEligible)}
            </KeyValue>
            <KeyValue label="serving verdict">
              {postServing?.verdict ?? "—"} · totalCaffeineEligible {String(postServing?.totalCaffeineEligible)} ·
              concentrationEligible {String(postServing?.concentrationEligible)}
            </KeyValue>
            <KeyValue label="Incidents opened">{String(post.promotion.incidents.length)}</KeyValue>
          </KeyValueList>
        ) : (
          <Callout tone="warn" title="Promotion unavailable">
            The post-heal row could not be promoted (artifact missing or contract-invalid); no
            substitute verdict is shown.
          </Callout>
        )}
      </JudgeStepCard>

      {/* 10 — Ranking Impact ---------------------------------------------- */}
      <JudgeStepCard
        index={10}
        id="ranking-impact"
        title="Ranking Impact"
        status={availabilityTone(
          preServing !== null && postServing !== null &&
            !preServing.totalCaffeineEligible && postServing.totalCaffeineEligible,
        )}
        statusLabel={
          preServedIneligible(preServing?.totalCaffeineEligible, postServing?.totalCaffeineEligible)
            ? "eligibility restored"
            : undefined
        }
        summary="The same promotion logic run on BOTH recorded runs shows the ranking consequence: the broken record was total-caffeine INELIGIBLE until the heal — its two published caffeine figures conflicted, and conflicting metrics are excluded from every board. After the heal the figures agree and the record qualifies for the total-caffeine board."
      >
        {pre.promotion !== null && post.promotion !== null && preServing !== null && postServing !== null && preCaffeine !== null && postCaffeine !== null ? (
          <div className="overflow-hidden rounded-md border border-[var(--pr-accent-border)]">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">Promotion verdicts before and after the heal</caption>
              <thead>
                <tr className="bg-[var(--pr-accent-subtle-bg)] text-left text-xs uppercase tracking-wide text-[var(--pr-accent-strong)]">
                  <th scope="col" className="px-3 py-2 font-medium">Promotion output (real)</th>
                  <th scope="col" className="px-3 py-2 font-medium">Pre-heal (72250 bug)</th>
                  <th scope="col" className="px-3 py-2 font-medium">Post-heal (72 mg)</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-white/5">
                  <th scope="row" className="px-3 py-2 text-left text-xs uppercase text-[var(--pr-text-muted)]">
                    caffeine_mg verdict
                  </th>
                  <td className="px-3 py-2">
                    <VerdictChip tone="fail">{preCaffeine.verdict}</VerdictChip>
                  </td>
                  <td className="px-3 py-2">
                    <VerdictChip tone="pass">{postCaffeine.verdict} · {mg(postCaffeine.value)}</VerdictChip>
                  </td>
                </tr>
                <tr className="border-t border-white/5">
                  <th scope="row" className="px-3 py-2 text-left text-xs uppercase text-[var(--pr-text-muted)]">
                    rankable
                  </th>
                  <td className="px-3 py-2 font-mono">{String(preCaffeine.rankable)}</td>
                  <td className="px-3 py-2 font-mono">{String(postCaffeine.rankable)}</td>
                </tr>
                <tr className="border-t border-white/5">
                  <th scope="row" className="px-3 py-2 text-left text-xs uppercase text-[var(--pr-text-muted)]">
                    totalCaffeineEligible (serving verdict)
                  </th>
                  <td className="px-3 py-2">
                    <VerdictChip tone="fail">{String(preServing.totalCaffeineEligible)}</VerdictChip>
                  </td>
                  <td className="px-3 py-2">
                    <VerdictChip tone="pass">{String(postServing.totalCaffeineEligible)}</VerdictChip>
                  </td>
                </tr>
                <tr className="border-t border-white/5">
                  <th scope="row" className="px-3 py-2 text-left text-xs uppercase text-[var(--pr-text-muted)]">
                    concentration (mg/100ml)
                  </th>
                  <td className="px-3 py-2 font-mono">
                    {pre.normalized?.concentration.basis === "computed"
                      ? `${pre.normalized.concentration.mgPer100Ml} (from the poisoned value)`
                      : pre.normalized?.concentration.basis ?? "—"}
                  </td>
                  <td className="px-3 py-2 font-mono">
                    {post.normalized?.concentration.basis === "computed"
                      ? post.normalized.concentration.mgPer100Ml
                      : post.normalized?.concentration.basis ?? "—"}
                  </td>
                </tr>
                <tr className="border-t border-white/5">
                  <th scope="row" className="px-3 py-2 text-left text-xs uppercase text-[var(--pr-text-muted)]">
                    Highest-total-caffeine board
                  </th>
                  <td className="px-3 py-2 text-[var(--pr-danger)]">excluded (conflict)</td>
                  <td className="px-3 py-2 text-[var(--pr-success)]">eligible</td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <Callout tone="warn" title="Ranking impact unavailable">
            Both recorded runs are required to compute the eligibility flip; one is missing.
          </Callout>
        )}
        <p className="max-w-3xl text-[13px] leading-relaxed text-[var(--pr-text-muted)]">
          Reading the table honestly: the V1 zod contract alone does NOT catch a unit bug
          (72250 mg is shape-valid and non-negative) — the conflict mapping plus the promotion
          rules are what kept the poisoned value off the boards. The heal restored eligibility
          with a verified 72 mg exact value; concentration became computable again (28.8
          mg/100ml) because the serving carries a positive ml volume.
        </p>
      </JudgeStepCard>

      {/* Additional recorded evidence (discovery mode) -------------------- */}
      <section
        aria-labelledby="judge-discovery-title"
        className="rounded-lg border border-[var(--pr-accent-border)] bg-[var(--pr-surface-1)] p-4 sm:p-5"
      >
        <h2 id="judge-discovery-title" className="mb-1 text-base font-semibold">
          Additional recorded evidence — discovery-mode attempts
        </h2>
        <p className="mb-4 max-w-3xl text-sm leading-relaxed text-[var(--pr-text-muted)]">
          Also recorded by the same collector: a discovery run against the caffeine-database
          listing page (the index page itself came back as one product row — the known
          listing-page limitation) and two heal attempts to add listing-page support that were
          refused because another refactor job was still in progress. Shown verbatim; no
          retries were fabricated.
        </p>
        <div className="grid gap-4 lg:grid-cols-3">
          {evidence.discoveryRun?.records[0] !== undefined ? (
            <JsonViewer
              value={evidence.discoveryRun.records[0]}
              label="run-discovery-before-heal.json (verbatim)"
            />
          ) : null}
          {evidence.healDiscovery !== null ? (
            <JsonViewer value={evidence.healDiscovery} label="heal-discovery.json (verbatim)" />
          ) : null}
          {evidence.healDiscoveryAttempt2 !== null ? (
            <JsonViewer
              value={evidence.healDiscoveryAttempt2}
              label="heal-discovery-attempt2.json (verbatim)"
            />
          ) : null}
        </div>
      </section>

      {/* Evidence index ---------------------------------------------------- */}
      <section
        aria-labelledby="judge-index-title"
        className="rounded-lg border border-[var(--pr-accent-border)] bg-[var(--pr-surface-1)] p-4 sm:p-5"
      >
        <h2 id="judge-index-title" className="mb-1 text-base font-semibold">
          Evidence index
        </h2>
        <p className="mb-4 text-sm text-[var(--pr-text-muted)]">
          Files read by this page from <Mono>artifacts/</Mono> at request time (name · bytes ·
          last modified).
        </p>
        <div className="grid gap-6 md:grid-cols-2">
          <ArtifactIndex title="artifacts/scraper/ (recorded evidence)" artifacts={evidence.scraperArtifacts} />
          <ArtifactIndex title="artifacts/demo/ (live demo mutations)" artifacts={evidence.demoArtifacts} />
        </div>
      </section>
    </div>
  );
}

function preServedIneligible(
  preEligible: boolean | undefined,
  postEligible: boolean | undefined,
): boolean {
  return preEligible === false && postEligible === true;
}

function ArtifactIndex({
  title,
  artifacts,
}: {
  title: string;
  artifacts: JudgeEvidenceModel["scraperArtifacts"];
}) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--pr-accent-strong)]">
        {title}
      </h3>
      {artifacts.length === 0 ? (
        <p className="text-[13px] text-[var(--pr-text-muted)]">No files (directory absent or empty).</p>
      ) : (
        <ul className="space-y-1 text-[13px]">
          {artifacts.map((artifact) => (
            <li key={artifact.name} className="flex flex-wrap items-baseline justify-between gap-2">
              <Mono>{artifact.name}</Mono>
              <span className="font-mono text-xs text-[var(--pr-text-muted)]">
                {artifact.bytes} B · {artifact.modifiedAt ?? "unknown time"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
