import { notFound } from "next/navigation";

/**
 * The former UNBROKEN operator namespace is retired. Keeping this boundary as
 * a real 404 prevents legacy transit pages from becoming an accidental public
 * API.
 */
export default function RetiredAdminLayout(): never {
  notFound();
}
