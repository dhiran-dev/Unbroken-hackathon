import type { PublicSignupAdmissionState } from "@/lib/public-signup-availability";

export type PublicSignupCapacityRow = {
  maxAccounts: unknown;
  activeAccounts: unknown;
  reservedAccounts: unknown;
  admissionState: unknown;
  emailCircuitState: unknown;
};

export function projectPublicSignupCapacityRow(
  row: PublicSignupCapacityRow | null | undefined,
): PublicSignupAdmissionState {
  if (row === null || row === undefined) return "unavailable";

  const {
    activeAccounts,
    admissionState,
    emailCircuitState,
    maxAccounts,
    reservedAccounts,
  } = row;

  if (
    maxAccounts !== 40 ||
    typeof activeAccounts !== "number" ||
    !Number.isSafeInteger(activeAccounts) ||
    activeAccounts < 0 ||
    typeof reservedAccounts !== "number" ||
    !Number.isSafeInteger(reservedAccounts) ||
    reservedAccounts < 0 ||
    activeAccounts + reservedAccounts > 40
  ) {
    return "unavailable";
  }

  if (admissionState !== "open" || emailCircuitState !== "closed") {
    return "paused";
  }

  return activeAccounts + reservedAccounts === 40 ? "full" : "open";
}

export type PublicSignupCapacityRowLoader = () => Promise<
  PublicSignupCapacityRow | null | undefined
>;

export function createPublicSignupAdmissionReader(
  loadRow: PublicSignupCapacityRowLoader,
): () => Promise<PublicSignupAdmissionState> {
  return async () => {
    try {
      return projectPublicSignupCapacityRow(await loadRow());
    } catch {
      return "unavailable";
    }
  };
}

async function loadSignupCapacityRow(): Promise<
  PublicSignupCapacityRow | undefined
> {
  const [{ eq }, { db }, { signupCapacity }] = await Promise.all([
    import("drizzle-orm"),
    import("@/server/db/client"),
    import("@/server/db/schema/auth"),
  ]);

  const [capacity] = await db
    .select({
      activeAccounts: signupCapacity.activeAccounts,
      admissionState: signupCapacity.admissionState,
      emailCircuitState: signupCapacity.emailCircuitState,
      maxAccounts: signupCapacity.maxAccounts,
      reservedAccounts: signupCapacity.reservedAccounts,
    })
    .from(signupCapacity)
    .where(eq(signupCapacity.id, 1))
    .limit(1);

  return capacity;
}
export const readPublicSignupAdmissionState = createPublicSignupAdmissionReader(
  loadSignupCapacityRow,
);
