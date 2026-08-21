import { redirect } from "next/navigation";

/** The old preview URL remains a safe alias for the HTML-first public home. */
export default function PulsePreviewPage() {
  redirect("/");
}
