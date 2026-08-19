import type {
  CatalogSnapshot,
  TransitCatalogStore,
  TransitCoverage,
} from "../../src/domain/transit/catalog";

export class MemoryTransitCatalogStore implements TransitCatalogStore {
  landmarkRevision = "landmarks-a";

  constructor(
    public activeSnapshotId: string | null,
    public snapshots: Map<string, CatalogSnapshot>,
    public coverage: TransitCoverage,
  ) {}

  async getActiveCatalogIdentity() {
    return this.activeSnapshotId
      ? {
          snapshotId: this.activeSnapshotId,
          landmarkRevision: this.landmarkRevision,
        }
      : null;
  }

  async loadSnapshot(snapshotId: string) {
    return this.activeSnapshotId === snapshotId
      ? (this.snapshots.get(snapshotId) ?? null)
      : null;
  }

  async getCoverage() {
    return this.coverage;
  }
}
