async function getGraphToken() {
  const issuerTenantId = process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER?.match(
    /login\.microsoftonline\.com\/([^/]+)/
  )?.[1];
  const tenantId = process.env.AZURE_TENANT_ID || issuerTenantId;
  const clientId =
    process.env.AZURE_GRAPH_CLIENT_ID || process.env.AUTH_MICROSOFT_ENTRA_ID_ID;
  const clientSecret =
    process.env.AZURE_GRAPH_CLIENT_SECRET ||
    process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error("Missing Microsoft Graph app credentials.");
  }

  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
    }
  );

  if (!res.ok) {
    throw new Error(`Failed to get Microsoft Graph token: ${await res.text()}`);
  }

  const json = await res.json();
  return json.access_token as string;
}

export interface ExternalReviewerPrincipal {
  id: string;
  email: string;
  displayName?: string;
}

export interface EntraUserPrincipal {
  id: string;
  email: string;
  displayName: string;
}

export type ProgramCollaboratorRole =
  | "Program Owner"
  | "DRG Staff"
  | "External Reviewer";

export interface ProgramCollaboratorPrincipal extends EntraUserPrincipal {
  accessRole: ProgramCollaboratorRole;
  eligibleAccessRoles: ProgramCollaboratorRole[];
}

function getPrincipalEmail(user: {
  mail?: string | null;
  userPrincipalName?: string | null;
}) {
  return user.mail ?? user.userPrincipalName ?? "";
}

function matchesUserQuery(user: EntraUserPrincipal, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;

  return (
    user.displayName.toLowerCase().includes(normalizedQuery) ||
    user.email.toLowerCase().includes(normalizedQuery)
  );
}

function escapeGraphFilterValue(value: string) {
  return value.trim().toLowerCase().replace(/'/g, "''");
}

function normalizePrincipalEmail(value: string) {
  return value.trim().toLowerCase();
}

function getConfiguredProgramAccessGroups() {
  return [
    {
      groupId: process.env.ENTRA_DRG_PROGRAM_OWNER_GROUP_ID,
      accessRole: "Program Owner" as const,
    },
    {
      groupId: process.env.ENTRA_DRG_STAFF_GROUP_ID,
      accessRole: "DRG Staff" as const,
    },
    {
      groupId: process.env.ENTRA_EXTERNAL_REVIEWER_GROUP_ID,
      accessRole: "External Reviewer" as const,
    },
  ].filter((group): group is { groupId: string; accessRole: ProgramCollaboratorRole } =>
    Boolean(group.groupId)
  );
}

function roleIsEligibleFromGroup(
  requestedRole: ProgramCollaboratorRole,
  groupAccessRole: ProgramCollaboratorRole
) {
  if (requestedRole === groupAccessRole) return true;

  return requestedRole === "DRG Staff" && groupAccessRole === "Program Owner";
}

async function listGroupUserMembers(
  token: string,
  groupId: string
): Promise<EntraUserPrincipal[]> {
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/groups/${groupId}/transitiveMembers/microsoft.graph.user?$select=id,mail,userPrincipalName,displayName&$top=999`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    }
  );

  if (!res.ok) {
    throw new Error(`Failed to load group members: ${await res.text()}`);
  }

  const json = (await res.json()) as {
    value?: Array<{
      id: string;
      mail?: string | null;
      userPrincipalName?: string | null;
      displayName?: string | null;
    }>;
  };

  return (
    json.value
      ?.map((user) => ({
        id: user.id,
        email: getPrincipalEmail(user),
        displayName: user.displayName ?? getPrincipalEmail(user),
      }))
      .filter((user) => user.email) ?? []
  );
}

async function listUserGroupIds(token: string, userId: string) {
  const memberOfRes = await fetch(
    `https://graph.microsoft.com/v1.0/users/${userId}/transitiveMemberOf/microsoft.graph.group?$select=id`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    }
  );

  if (!memberOfRes.ok) {
    throw new Error(
      `Failed to verify group membership: ${await memberOfRes.text()}`
    );
  }

  const memberOfJson = (await memberOfRes.json()) as {
    value?: Array<{ id: string }>;
  };
  return new Set(memberOfJson.value?.map((group) => group.id) ?? []);
}

function resolveEligibleProgramAccessRoles(groupIds: Set<string>) {
  const roles = new Set<ProgramCollaboratorRole>();

  for (const group of getConfiguredProgramAccessGroups()) {
    if (!groupIds.has(group.groupId)) continue;

    roles.add(group.accessRole);
    if (group.accessRole === "Program Owner") roles.add("DRG Staff");
  }

  return [...roles];
}

function resolveDefaultProgramAccessRole(
  roles: readonly ProgramCollaboratorRole[]
) {
  if (roles.includes("Program Owner")) return "Program Owner";
  return roles[0];
}

export async function listProgramOwnerPrincipals(
  query = ""
): Promise<EntraUserPrincipal[]> {
  const programOwnerGroupId = process.env.ENTRA_DRG_PROGRAM_OWNER_GROUP_ID;

  if (!programOwnerGroupId) {
    throw new Error("Missing ENTRA_DRG_PROGRAM_OWNER_GROUP_ID.");
  }

  const token = await getGraphToken();
  const users = await listGroupUserMembers(token, programOwnerGroupId);

  return users
    .filter((user) => matchesUserQuery(user, query))
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
    .slice(0, 50);
}

export async function searchProgramCollaboratorPrincipals(
  query = ""
): Promise<ProgramCollaboratorPrincipal[]> {
  const token = await getGraphToken();
  const groups = getConfiguredProgramAccessGroups();

  if (groups.length === 0) {
    throw new Error("Missing Entra program access group IDs.");
  }

  const byId = new Map<string, ProgramCollaboratorPrincipal>();

  for (const group of groups) {
    const members = await listGroupUserMembers(token, group.groupId);
    for (const member of members) {
      if (!matchesUserQuery(member, query)) continue;

      const existing = byId.get(member.id);
      if (existing) {
        if (!existing.eligibleAccessRoles.includes(group.accessRole)) {
          existing.eligibleAccessRoles.push(group.accessRole);
        }
        if (
          group.accessRole === "Program Owner" &&
          !existing.eligibleAccessRoles.includes("DRG Staff")
        ) {
          existing.eligibleAccessRoles.push("DRG Staff");
        }
        existing.accessRole =
          resolveDefaultProgramAccessRole(existing.eligibleAccessRoles) ??
          existing.accessRole;
        continue;
      }

      const eligibleAccessRoles: ProgramCollaboratorRole[] = [group.accessRole];
      if (group.accessRole === "Program Owner") {
        eligibleAccessRoles.push("DRG Staff");
      }

      byId.set(member.id, {
        ...member,
        accessRole:
          resolveDefaultProgramAccessRole(eligibleAccessRoles) ??
          group.accessRole,
        eligibleAccessRoles,
      });
    }
  }

  return [...byId.values()]
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
    .slice(0, 50);
}

export async function getProgramCollaboratorPrincipal(
  email: string,
  requestedAccessRole?: ProgramCollaboratorRole
): Promise<ProgramCollaboratorPrincipal | null> {
  const token = await getGraphToken();
  const normalizedEmail = escapeGraphFilterValue(email);
  const usersRes = await fetch(
    `https://graph.microsoft.com/v1.0/users?$select=id,mail,userPrincipalName,displayName&$top=1&$filter=mail eq '${normalizedEmail}' or userPrincipalName eq '${normalizedEmail}'`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    }
  );

  if (!usersRes.ok) {
    throw new Error(`Failed to verify collaborator: ${await usersRes.text()}`);
  }

  const usersJson = (await usersRes.json()) as {
    value?: Array<{
      id: string;
      mail?: string | null;
      userPrincipalName?: string | null;
      displayName?: string | null;
    }>;
  };
  const user = usersJson.value?.[0];

  if (!user) return null;

  const groupIds = await listUserGroupIds(token, user.id);
  const eligibleAccessRoles = resolveEligibleProgramAccessRoles(groupIds);
  if (requestedAccessRole) {
    const eligibleFromConfiguredGroup = getConfiguredProgramAccessGroups().some(
      (group) =>
        groupIds.has(group.groupId) &&
        roleIsEligibleFromGroup(requestedAccessRole, group.accessRole)
    );
    if (!eligibleFromConfiguredGroup) return null;
  }

  const accessRole =
    requestedAccessRole ?? resolveDefaultProgramAccessRole(eligibleAccessRoles);
  if (!accessRole) return null;

  const emailAddress = getPrincipalEmail(user);
  if (!emailAddress) return null;

  return {
    id: user.id,
    email: emailAddress,
    displayName: user.displayName ?? emailAddress,
    accessRole,
    eligibleAccessRoles,
  };
}

export async function getEntraUserPrincipalsByEmail(
  emails: readonly string[]
): Promise<Map<string, EntraUserPrincipal>> {
  const uniqueEmails = [...new Set(emails.map(normalizePrincipalEmail).filter(Boolean))];
  const principals = new Map<string, EntraUserPrincipal>();

  if (uniqueEmails.length === 0) return principals;

  const token = await getGraphToken();

  await Promise.all(
    uniqueEmails.map(async (email) => {
      const normalizedEmail = escapeGraphFilterValue(email);
      const usersRes = await fetch(
        `https://graph.microsoft.com/v1.0/users?$select=id,mail,userPrincipalName,displayName&$top=1&$filter=mail eq '${normalizedEmail}' or userPrincipalName eq '${normalizedEmail}'`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          cache: "no-store",
        }
      );

      if (!usersRes.ok) {
        throw new Error(`Failed to load Entra user: ${await usersRes.text()}`);
      }

      const usersJson = (await usersRes.json()) as {
        value?: Array<{
          id: string;
          mail?: string | null;
          userPrincipalName?: string | null;
          displayName?: string | null;
        }>;
      };
      const user = usersJson.value?.[0];
      const emailAddress = user ? getPrincipalEmail(user) : "";

      if (!user || !emailAddress) return;

      principals.set(normalizePrincipalEmail(emailAddress), {
        id: user.id,
        email: emailAddress,
        displayName: user.displayName ?? emailAddress,
      });
    })
  );

  return principals;
}

export async function getExternalReviewerPrincipal(
  email: string
): Promise<ExternalReviewerPrincipal | null> {
  const externalReviewerGroupId = process.env.ENTRA_EXTERNAL_REVIEWER_GROUP_ID;

  if (!externalReviewerGroupId) {
    throw new Error("Missing ENTRA_EXTERNAL_REVIEWER_GROUP_ID.");
  }

  const token = await getGraphToken();
  const normalizedEmail = escapeGraphFilterValue(email);
  const usersRes = await fetch(
    `https://graph.microsoft.com/v1.0/users?$select=id,mail,userPrincipalName,displayName&$top=1&$filter=mail eq '${normalizedEmail}' or userPrincipalName eq '${normalizedEmail}'`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    }
  );

  if (!usersRes.ok) {
    throw new Error(`Failed to verify external reviewer: ${await usersRes.text()}`);
  }

  const usersJson = (await usersRes.json()) as {
    value?: Array<{
      id: string;
      mail?: string | null;
      userPrincipalName?: string | null;
      displayName?: string;
    }>;
  };
  const user = usersJson.value?.[0];

  if (!user) {
    return null;
  }

  const groupIds = await listUserGroupIds(token, user.id);
  if (!groupIds.has(externalReviewerGroupId)) return null;

  return {
    id: user.id,
    email: getPrincipalEmail(user) || email,
    displayName: user.displayName,
  };
}
