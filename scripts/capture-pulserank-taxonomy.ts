import { captureTaxonomyManifest } from "@/server/ingestion/taxonomy-capture";

const manifest = await captureTaxonomyManifest();
process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
