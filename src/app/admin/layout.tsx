import { notFound } from "next/navigation";

/**
 * The former UNBROKEN operator namespace is retired. PulseRank’s active
 * evidence surface is `/judge`; keeping this boundary as a real 404 prevents
 * legacy transit pages from becoming an accidental public API.
 */
export default function RetiredAdminLayout(): never {
  notFound();
}
