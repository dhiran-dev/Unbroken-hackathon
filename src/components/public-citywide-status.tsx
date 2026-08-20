import {
  CircleAlert,
  CircleCheck,
  CircleHelp,
  ExternalLink,
  MapPin,
} from "lucide-react";

import { Card } from "@/components/ui/card";
import { formatPacific } from "@/lib/format";
import type {
  PublicAdvisoryItem,
  PublicAlertItem,
  PublicCitywideStatusView,
  PublicCitywideStatusFilter,
  PublicGuideItem,
  PublicRelocationItem,
  PublicStatusSection,
  PublicStatusState,
} from "@/server/citywide-status/public-citywide-status";

const statusLabels: Record<PublicStatusState, string> = {
  current: "Current",
  older: "Older information",
  unavailable: "Unavailable",
};

function stateClass(state: PublicStatusState) {
  if (state === "current")
    return "border-success/30 bg-success/10 text-success-foreground";
  if (state === "older")
    return "border-warning/35 bg-warning/10 text-warning-foreground";
  return "border-border bg-muted text-muted-foreground";
}

function StateBadge({ state }: { state: PublicStatusState }) {
  const Icon =
    state === "current"
      ? CircleCheck
      : state === "older"
        ? CircleAlert
        : CircleHelp;
  return (
    <span
      className={`inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${stateClass(state)}`}
      data-state={state}
    >
      <Icon aria-hidden="true" className="size-3.5" />
      {statusLabels[state]}
    </span>
  );
}

function SourceTimes({
  checkedAt,
  sourceUpdatedAt,
  sourceUrl,
  realtime = false,
}: {
  checkedAt: Date | null;
  sourceUpdatedAt: Date | null;
  sourceUrl: string;
  realtime?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span>
        <span className="font-medium text-foreground">
          Checked by UNBROKEN at
        </span>{" "}
        {formatPacific(checkedAt)}
      </span>
      {sourceUpdatedAt && (
        <span>
          <span className="font-medium text-foreground">
            {realtime ? "511 updated at" : "SFMTA updated at"}
          </span>{" "}
          {formatPacific(sourceUpdatedAt)}
        </span>
      )}
      <a
        className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline"
        href={sourceUrl}
        rel="noopener noreferrer"
        target="_blank"
      >
        Official source <ExternalLink aria-hidden="true" className="size-3" />
        <span className="sr-only">(opens in a new tab)</span>
      </a>
    </div>
  );
}

function SectionHeader({
  title,
  section,
  realtime = false,
}: {
  title: string;
  section:
    | {
        state: PublicStatusState;
        checkedAt: Date | null;
        sourceUpdatedAt: Date | null;
        sourceUrl: string;
        summary: string;
      }
    | PublicCitywideStatusView["elevators"];
  realtime?: boolean;
}) {
  return (
    <div className="border-b p-5 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {section.summary}
          </p>
        </div>
        <StateBadge state={section.state} />
      </div>
      <div className="mt-4">
        <SourceTimes
          checkedAt={section.checkedAt}
          realtime={realtime}
          sourceUpdatedAt={section.sourceUpdatedAt}
          sourceUrl={section.sourceUrl}
        />
      </div>
    </div>
  );
}

function EmptySection({
  section,
}: {
  section: { state: PublicStatusState; summary: string };
}) {
  if (section.state === "current") {
    return (
      <p className="p-5 text-sm text-muted-foreground">No current changes.</p>
    );
  }
  if (section.state === "older") {
    return (
      <p className="p-5 text-sm text-warning-foreground">
        Older information is shown above.
      </p>
    );
  }
  return (
    <p className="p-5 text-sm text-muted-foreground">
      Current information is unavailable.
    </p>
  );
}

function ExternalSourceLink({ href }: { href: string }) {
  return (
    <a
      className="inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline"
      href={href}
      rel="noopener noreferrer"
      target="_blank"
    >
      Official source <ExternalLink aria-hidden="true" className="size-3" />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

function ElevatorSection({
  status,
}: {
  status: PublicCitywideStatusView["elevators"];
}) {
  return (
    <Card className="overflow-hidden">
      <SectionHeader section={status} title="Elevators and stations" />
      {status.stations.length === 0 ? (
        <EmptySection section={status} />
      ) : (
        <div className="divide-y">
          {status.stations.map((station, stationIndex) => (
            <details
              className="group"
              key={`station-${stationIndex}-${station.slug}`}
              open
            >
              <summary className="flex min-w-0 cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 [&::-webkit-details-marker]:hidden sm:px-6">
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {station.name}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {station.elevators.length} elevator
                    {station.elevators.length === 1 ? "" : "s"}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span
                    className={`rounded-full border px-2.5 py-1 text-xs font-medium ${stateClass(station.state === "accessible" ? "current" : station.state === "unknown" ? "unavailable" : "older")}`}
                  >
                    {station.state === "accessible"
                      ? "Step-free access available"
                      : station.state === "limited"
                        ? "Step-free access with changes"
                        : station.state === "unavailable"
                          ? "No confirmed step-free access"
                          : "Access not confirmed"}
                  </span>
                </span>
              </summary>
              <div className="border-t px-5 sm:px-6">
                {station.elevators.map((elevator, elevatorIndex) => (
                  <div
                    className="flex flex-col gap-2 border-b py-4 last:border-b-0 sm:flex-row sm:items-start sm:justify-between"
                    key={`elevator-${elevatorIndex}-${elevator.name}`}
                  >
                    <div className="min-w-0">
                      <h3 className="text-sm font-medium">{elevator.name}</h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {elevator.role} · Checked by UNBROKEN at{" "}
                        {formatPacific(status.checkedAt)}
                      </p>
                      {elevator.alternativeName &&
                        elevator.state !== "working" && (
                          <p className="mt-2 text-sm leading-6 text-muted-foreground">
                            Use {elevator.alternativeName} instead for this part
                            of the station.
                          </p>
                        )}
                    </div>
                    <span className="inline-flex w-fit items-center gap-1.5 rounded-full border bg-muted px-2.5 py-1 text-xs font-medium">
                      {elevator.state === "working"
                        ? "Working"
                        : elevator.state === "out_of_service"
                          ? "Out of service"
                          : "Status not confirmed"}
                    </span>
                  </div>
                ))}
              </div>
            </details>
          ))}
        </div>
      )}
    </Card>
  );
}

function AdvisoryItems({
  items,
  sourceUrl,
}: {
  items: PublicAdvisoryItem[];
  sourceUrl: string;
}) {
  if (items.length === 0) return null;
  return (
    <ul className="divide-y" aria-label="Accessibility advisories">
      {items.map((item, itemIndex) => (
        <li
          className="flex min-w-0 flex-col gap-3 p-5 sm:p-6"
          key={`advisory-${itemIndex}`}
        >
          <div className="min-w-0">
            <h3 className="font-medium">{item.title}</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {item.affectedRoutes.length > 0 && (
                <>Routes: {item.affectedRoutes.join(", ")}. </>
              )}
              {item.affectedStops.length > 0 && (
                <>Stops: {item.affectedStops.join(", ")}.</>
              )}
            </p>
          </div>
          <ExternalSourceLink href={item.publicUrl || sourceUrl} />
        </li>
      ))}
    </ul>
  );
}

function RelocationItems({
  items,
  sourceUrl,
}: {
  items: PublicRelocationItem[];
  sourceUrl: string;
}) {
  if (items.length === 0) return null;
  return (
    <ul className="divide-y" aria-label="Moved stops">
      {items.map((item, itemIndex) => (
        <li
          className="min-w-0 space-y-2 p-5 sm:p-6"
          key={`relocation-${itemIndex}`}
        >
          <h3 className="font-medium">{item.stopName}</h3>
          <p className="text-sm text-muted-foreground">
            Routes: {item.routeNames.join(", ")}
          </p>
          <p className="text-sm leading-6">
            Board at {item.temporaryStop}. {item.boardingInstruction}
          </p>
          <p className="text-xs text-muted-foreground">
            {item.scheduleText} · {formatPacific(item.startsAt)} to{" "}
            {formatPacific(item.endsAt)}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <ExternalSourceLink href={item.publicUrl || sourceUrl} />
            {item.latitude !== null && item.longitude !== null && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin aria-hidden="true" className="size-3.5" /> Location
                available
              </span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

function GuideItems({
  items,
  sourceUrl,
}: {
  items: PublicGuideItem[];
  sourceUrl: string;
}) {
  if (items.length === 0) return null;
  return (
    <ul className="divide-y" aria-label="Accessible-stop guidance">
      {items.map((item, itemIndex) => (
        <li className="min-w-0 space-y-2 p-5 sm:p-6" key={`guide-${itemIndex}`}>
          <h3 className="font-medium">{item.stationName}</h3>
          <p className="text-sm text-muted-foreground">
            Routes: {item.routeNames.join(", ")}
          </p>
          <p className="text-sm leading-6">{item.guidance}</p>
          <p className="text-xs text-muted-foreground">
            Accessibility details need checking at the station.
          </p>
          <ExternalSourceLink href={sourceUrl} />
        </li>
      ))}
    </ul>
  );
}

function AlertItems({
  items,
  sourceUrl,
}: {
  items: PublicAlertItem[];
  sourceUrl: string;
}) {
  if (items.length === 0) return null;
  return (
    <ul className="divide-y" aria-label="Current service alerts">
      {items.map((item, itemIndex) => (
        <li className="min-w-0 space-y-2 p-5 sm:p-6" key={`alert-${itemIndex}`}>
          <h3 className="font-medium">{item.header}</h3>
          {item.effect && <p className="text-sm">Effect: {item.effect}</p>}
          {item.routeIds.length > 0 && (
            <p className="text-sm text-muted-foreground">
              Routes: {item.routeIds.join(", ")}
            </p>
          )}
          {item.stopIds.length > 0 && (
            <p className="text-sm text-muted-foreground">
              Stops: {item.stopIds.join(", ")}
            </p>
          )}
          <ExternalSourceLink href={sourceUrl} />
        </li>
      ))}
    </ul>
  );
}

function GenericSection({
  title,
  section,
  children,
  realtime = false,
}: {
  title: string;
  section: PublicStatusSection<unknown>;
  children: React.ReactNode;
  realtime?: boolean;
}) {
  return (
    <Card className="overflow-hidden" aria-label={title}>
      <SectionHeader realtime={realtime} section={section} title={title} />
      {section.items.length === 0 ? (
        <EmptySection section={section} />
      ) : (
        children
      )}
    </Card>
  );
}

export function isPublicStatusSectionVisible(
  type: Exclude<PublicCitywideStatusFilter["type"], "all">,
  section: { state: PublicStatusState; count: number },
  filter?: PublicCitywideStatusFilter,
) {
  if (!filter) return true;
  if (filter.type !== "all" && filter.type !== type) return false;
  if (filter.state !== "all" && filter.state !== section.state) return false;
  return filter.query.trim().length === 0 || section.count > 0;
}

export function PublicCitywideStatusSurface({
  status,
  filter,
}: {
  status: PublicCitywideStatusView;
  filter?: PublicCitywideStatusFilter;
}) {
  const visible = {
    elevators: isPublicStatusSectionVisible(
      "elevators",
      status.elevators,
      filter,
    ),
    advisories: isPublicStatusSectionVisible(
      "advisories",
      status.advisories,
      filter,
    ),
    relocations: isPublicStatusSectionVisible(
      "relocations",
      status.relocations,
      filter,
    ),
    guides: isPublicStatusSectionVisible("guides", status.guides, filter),
    alerts: isPublicStatusSectionVisible("alerts", status.alerts, filter),
  };
  const hasVisibleSection = Object.values(visible).some(Boolean);

  return (
    <div className="space-y-5">
      {visible.elevators && <ElevatorSection status={status.elevators} />}
      {visible.advisories && (
        <GenericSection
          section={status.advisories}
          title="Accessibility advisories"
        >
          <AdvisoryItems
            items={status.advisories.items}
            sourceUrl={status.advisories.sourceUrl}
          />
        </GenericSection>
      )}
      {visible.relocations && (
        <GenericSection section={status.relocations} title="Moved stops">
          <RelocationItems
            items={status.relocations.items}
            sourceUrl={status.relocations.sourceUrl}
          />
        </GenericSection>
      )}
      {visible.guides && (
        <GenericSection
          section={status.guides}
          title="Accessible-stop guidance"
        >
          <GuideItems
            items={status.guides.items}
            sourceUrl={status.guides.sourceUrl}
          />
        </GenericSection>
      )}
      {visible.alerts && (
        <GenericSection
          realtime
          section={status.alerts}
          title="Current service alerts"
        >
          <AlertItems
            items={status.alerts.items}
            sourceUrl={status.alerts.sourceUrl}
          />
        </GenericSection>
      )}
      {!hasVisibleSection && filter && (
        <p
          className="rounded-xl border p-5 text-sm text-muted-foreground"
          role="status"
        >
          No matching status updates.
        </p>
      )}
    </div>
  );
}
