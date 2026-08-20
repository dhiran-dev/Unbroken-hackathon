import type { PublicAccessibility } from "@/domain/accessibility/model";

export type AccessibilityElevatorRead = {
  accessibility: PublicAccessibility;
  checkedAt: Date;
};

type TrustedElevatorMetadata = {
  snapshotId: string;
  sourceValidAt: Date;
  checkedAt: Date;
};

type ElevatorReadDependencies = {
  readMetadata(): Promise<TrustedElevatorMetadata | null>;
  readPublic(at: Date): Promise<PublicAccessibility | null>;
};

function sameMetadata(
  left: TrustedElevatorMetadata,
  right: TrustedElevatorMetadata,
) {
  return (
    left.snapshotId === right.snapshotId &&
    left.sourceValidAt.getTime() === right.sourceValidAt.getTime() &&
    left.checkedAt.getTime() === right.checkedAt.getTime()
  );
}

export function createAccessibilityElevatorReader(
  dependencies: ElevatorReadDependencies,
) {
  return async (at: Date): Promise<AccessibilityElevatorRead | null> => {
    try {
      const before = await dependencies.readMetadata();
      if (!before) return null;
      const accessibility = await dependencies.readPublic(new Date(at));
      const after = await dependencies.readMetadata();
      if (!accessibility || !after || !sameMetadata(before, after)) return null;
      if (
        accessibility.trust.sourceValidAt.getTime() !==
        before.sourceValidAt.getTime()
      )
        return null;
      return { accessibility, checkedAt: new Date(before.checkedAt) };
    } catch {
      return null;
    }
  };
}
