import { z } from "zod";

export const COLLECTION_CONTRACT_VERSION = "sfmta-elevators-v1";

export const equipmentStatusSchema = z.enum([
  "in_service",
  "out_of_service",
  "unknown",
]);

export const stationAccessibilitySchema = z.enum([
  "accessible",
  "not_accessible",
  "unknown",
]);

export const rawElevatorRowSchema = z
  .object({
    station_name: z.string().nullable(),
    station_accessibility: stationAccessibilitySchema.nullable(),
    equipment_name: z.string().nullable(),
    equipment_type: z.literal("elevator").nullable(),
    equipment_status: equipmentStatusSchema.nullable(),
    last_changed_text: z.string().nullable(),
    source_valid_text: z.string().nullable(),
    source_url: z.string().url(),
  })
  .strict();

export const collectorDatasetSchema = z.array(
  z
    .object({
      elevators: z.array(rawElevatorRowSchema),
      input: z
        .object({
          url: z.string().url(),
        })
        .passthrough()
        .optional(),
    })
    .passthrough(),
);

export type RawElevatorRow = z.infer<typeof rawElevatorRowSchema>;
export type CollectorDataset = z.infer<typeof collectorDatasetSchema>;

export function flattenCollectorDataset(dataset: CollectorDataset) {
  return dataset.flatMap((record) => record.elevators);
}
