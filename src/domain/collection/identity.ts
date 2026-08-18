import { createHash } from "node:crypto";

export function normalizeWhitespace(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function equipmentIdentity(stationName: string, equipmentName: string) {
  return `${normalizeWhitespace(stationName).toLocaleLowerCase("en-US")}|${normalizeWhitespace(equipmentName).toLocaleLowerCase("en-US")}`;
}

export function equipmentSourceKey(stationName: string, equipmentName: string) {
  const digest = createHash("sha256")
    .update(equipmentIdentity(stationName, equipmentName))
    .digest("hex")
    .slice(0, 32);
  return `sfmta:${digest}`;
}

export function sha256Json(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
