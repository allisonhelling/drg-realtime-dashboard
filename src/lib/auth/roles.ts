export const INTERNAL_ROLES = [
  "drg-admin",
  "drg-program-owner",
  "drg-staff",
  "external-reviewer",
] as const;
export const EFFECTIVE_ROLES = [
  "drg-admin",
  "drg-program-owner",
  "drg-staff",
  "external-reviewer",
  "gov-reviewer",
] as const;

export type InternalRole = (typeof INTERNAL_ROLES)[number];
export type EffectiveRole = (typeof EFFECTIVE_ROLES)[number];

export const ROLE_LABELS: Record<EffectiveRole, string> = {
  "drg-admin": "DRG Admin",
  "drg-program-owner": "DRG Program Owner",
  "drg-staff": "DRG Staff",
  "external-reviewer": "External Reviewer",
  "gov-reviewer": "Gov Reviewer",
};

const ENTRA_APP_ROLE_TO_INTERNAL_ROLE: Record<string, InternalRole> = {
  "drg-admin": "drg-admin",
  "drg-admins": "drg-admin",
  drg_admin: "drg-admin",
  drg_admins: "drg-admin",
  "DRG Admin": "drg-admin",
  "drg_program_owner": "drg-program-owner",
  "drg-program-owner": "drg-program-owner",
  "drg-program-owners": "drg-program-owner",
  drg_program_owners: "drg-program-owner",
  "DRG Program Owner": "drg-program-owner",
  "drg-staff": "drg-staff",
  drg_staff: "drg-staff",
  "DRG Staff": "drg-staff",
  "external-reviewer": "external-reviewer",
  "external-reviewers": "external-reviewer",
  external_reviewer: "external-reviewer",
  external_reviewers: "external-reviewer",
  "external-user": "external-reviewer",
  external_user: "external-reviewer",
  "DRG External Reviewer": "external-reviewer",
};

function normalizeRoleClaim(role: string) {
  return role.trim().replace(/[\s_]+/g, "-").toLowerCase();
}

function getEntraGroupToInternalRole(): Record<string, InternalRole> {
  return Object.fromEntries(
    [
      [process.env.ENTRA_DRG_ADMIN_GROUP_ID, "drg-admin"],
      [process.env.ENTRA_DRG_PROGRAM_OWNER_GROUP_ID, "drg-program-owner"],
      [process.env.ENTRA_DRG_STAFF_GROUP_ID, "drg-staff"],
      [process.env.ENTRA_EXTERNAL_REVIEWER_GROUP_ID, "external-reviewer"],
    ]
      .filter(
        (entry): entry is [string, InternalRole] =>
          typeof entry[0] === "string" && entry[0].trim().length > 0
      )
      .map(([groupId, role]) => [groupId.trim(), role])
  );
}

export function normalizeEmail(email: string | null | undefined) {
  return String(email ?? "").trim().toLowerCase();
}

export function mapClaimsToInternalRoles(claims: Record<string, unknown>): InternalRole[] {
  const roles = Array.isArray(claims.roles) ? claims.roles.map(String) : [];
  const groups = Array.isArray(claims.groups) ? claims.groups.map(String) : [];

  const mapped = new Set<InternalRole>();

  for (const role of roles) {
    const internalRole =
      ENTRA_APP_ROLE_TO_INTERNAL_ROLE[role] ??
      ENTRA_APP_ROLE_TO_INTERNAL_ROLE[normalizeRoleClaim(role)];
    if (internalRole) mapped.add(internalRole);
  }

  const groupToInternalRole = getEntraGroupToInternalRole();
  for (const group of groups) {
    const internalRole = groupToInternalRole[group.trim()];
    if (internalRole) mapped.add(internalRole);
  }

  return [...mapped];
}

export function hasAnyRole<T extends string>(
  actual: readonly T[],
  allowed: readonly T[]
) {
  return allowed.some((role) => actual.includes(role));
}
