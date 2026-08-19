import { ArrowLeft, ArrowRight, Download } from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function linkHref(basePath: string, source: URLSearchParams, changes: Record<string, string | null>) {
  const params = new URLSearchParams(source);
  for (const [key, value] of Object.entries(changes)) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
  const search = params.toString();
  return search ? `${basePath}?${search}` : basePath;
}

type AdminPaginationProps = {
  basePath: string;
  query: URLSearchParams;
  total: number;
  pageSize: number;
  nextCursor: string | null;
};

export function AdminPagination({
  basePath,
  query,
  total,
  pageSize,
  nextCursor,
}: AdminPaginationProps) {
  const shown = Math.min(total, pageSize);
  const hasPrevious = query.has("cursor");
  const previousHref = linkHref(basePath, query, { cursor: null });
  const nextHref = nextCursor
    ? linkHref(basePath, query, { cursor: nextCursor })
    : null;

  return (
    <div className="flex flex-col gap-3 border-t px-5 py-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <span>
        {total === 0 ? "No matching records" : `Showing ${shown} of ${total.toLocaleString()} records`}
      </span>
      <div className="flex gap-2">
        {hasPrevious && (
          <Link className={cn(buttonVariants({ variant: "outline", size: "sm" }))} href={previousHref}>
            <ArrowLeft aria-hidden="true" /> Previous
          </Link>
        )}
        {nextHref && (
          <Link className={cn(buttonVariants({ variant: "outline", size: "sm" }))} href={nextHref}>
            Next <ArrowRight aria-hidden="true" />
          </Link>
        )}
      </div>
    </div>
  );
}

export function AdminExportLinks({
  endpoint,
  query,
}: {
  endpoint: string;
  query: URLSearchParams;
}) {
  const csvHref = linkHref(endpoint, query, { format: "csv", cursor: null });
  const jsonHref = linkHref(endpoint, query, { format: "json", cursor: null });
  return (
    <div className="flex flex-wrap gap-2">
      <Link className={cn(buttonVariants({ variant: "outline", size: "sm" }))} href={csvHref}>
        <Download aria-hidden="true" /> CSV
      </Link>
      <Link className={cn(buttonVariants({ variant: "ghost", size: "sm" }))} href={jsonHref}>
        JSON
      </Link>
    </div>
  );
}

export function queryFromRecord(record: Record<string, string | string[] | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "string" && value) query.set(key, value);
    if (Array.isArray(value) && value[0]) query.set(key, value[0]);
  }
  return query;
}
