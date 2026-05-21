import { afterEach, describe, expect, it, vi } from "vitest";
import { mapClaimsToInternalRoles } from "@/lib/auth/roles";

describe("Entra role claim mapping", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("maps common app role value variants to internal roles", () => {
    expect(
      mapClaimsToInternalRoles({
        roles: [
          "drg-program-owners",
          "DRG Staff",
          "external_reviewers",
          "DRG Admin",
        ],
      })
    ).toEqual([
      "drg-program-owner",
      "drg-staff",
      "external-reviewer",
      "drg-admin",
    ]);
  });

  it("maps security group object IDs from configured Entra group env vars", () => {
    vi.stubEnv("ENTRA_DRG_PROGRAM_OWNER_GROUP_ID", "program-owner-group-id");
    vi.stubEnv("ENTRA_EXTERNAL_REVIEWER_GROUP_ID", "external-reviewer-group-id");

    expect(
      mapClaimsToInternalRoles({
        groups: ["program-owner-group-id", "external-reviewer-group-id"],
      })
    ).toEqual(["drg-program-owner", "external-reviewer"]);
  });

  it("ignores blank Entra group env vars", () => {
    vi.stubEnv("ENTRA_DRG_PROGRAM_OWNER_GROUP_ID", "");

    expect(
      mapClaimsToInternalRoles({
        groups: [""],
      })
    ).toEqual([]);
  });
});
