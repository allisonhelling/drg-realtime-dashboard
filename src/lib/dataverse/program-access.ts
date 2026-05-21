import { MockProgramConnector } from "@/lib/connectors/mock-programs";
import { normalizeEmail } from "@/lib/auth/roles";
import { getEntraUserPrincipalsByEmail } from "@/lib/graph/users";
import type { ProgramAccess, ProgramAccessRole } from "@/lib/models/program";
import {
  dataverseFetch,
  DataverseError,
  escapeODataString,
  getFormattedValue,
  isDataverseConfigured,
  listRows,
  lookupBind,
} from "@/lib/dataverse/client";
import { businessRuleError } from "@/lib/errors/business-rules";

interface DataverseProgramAccessRow extends Record<string, unknown> {
  drg_programaccessid: string;
  drg_email?: string;
  drg_grantedon?: string;
  drg_grantedbyemail?: string;
  drg_isactive?: boolean;
  _drg_program_value?: string;
  _drg_user_value?: string;
  drg_revokedon?: string;
  drg_revokedbyemail?: string;
  drg_entraobjectid?: string;
}

export type ProgramAccessRecord = ProgramAccess;

const PROGRAM_ACCESS_ROLE_ENV: Record<ProgramAccessRole, string> = {
  "Program Owner": "DATAVERSE_PROGRAM_ACCESS_ROLE_PROGRAM_OWNER_VALUE",
  "DRG Staff": "DATAVERSE_PROGRAM_ACCESS_ROLE_DRG_STAFF_VALUE",
  "External Reviewer": "DATAVERSE_PROGRAM_ACCESS_ROLE_EXTERNAL_REVIEWER_VALUE",
  "Read Only": "DATAVERSE_PROGRAM_ACCESS_ROLE_READ_ONLY_VALUE",
};

type DataverseChoiceOption = {
  Value?: number;
  Label?: {
    UserLocalizedLabel?: {
      Label?: string;
    } | null;
    LocalizedLabels?: Array<{
      Label?: string;
    }>;
  };
};

type DataverseChoiceMetadata = {
  OptionSet?: {
    Options?: DataverseChoiceOption[];
  } | null;
  GlobalOptionSet?: {
    Options?: DataverseChoiceOption[];
  } | null;
};

let programAccessRoleOptionValuesPromise:
  | Promise<Map<ProgramAccessRole, number>>
  | undefined;

function parseProgramAccessRole(value: string | undefined) {
  switch (value) {
    case "Program Owner":
    case "DRG Staff":
    case "External Reviewer":
    case "Read Only":
      return value;
    default:
      return undefined;
  }
}

function toProgramAccessRole(value: string | undefined): ProgramAccessRole {
  return parseProgramAccessRole(value) ?? "External Reviewer";
}

function getChoiceOptionLabel(option: DataverseChoiceOption) {
  return (
    option.Label?.UserLocalizedLabel?.Label ??
    option.Label?.LocalizedLabels?.find((label) => label.Label)?.Label ??
    ""
  );
}

function getConfiguredProgramAccessRoleValue(role: ProgramAccessRole) {
  const raw = process.env[PROGRAM_ACCESS_ROLE_ENV[role]]?.trim();
  if (!raw) return undefined;

  const value = Number(raw);
  if (!Number.isInteger(value)) {
    throw new Error(
      `${PROGRAM_ACCESS_ROLE_ENV[role]} must be a Dataverse integer choice value.`
    );
  }

  return value;
}

async function loadProgramAccessRoleOptionValues() {
  const configuredValues = new Map<ProgramAccessRole, number>();
  for (const role of Object.keys(PROGRAM_ACCESS_ROLE_ENV) as ProgramAccessRole[]) {
    const configuredValue = getConfiguredProgramAccessRoleValue(role);
    if (configuredValue !== undefined) configuredValues.set(role, configuredValue);
  }

  if (configuredValues.size === Object.keys(PROGRAM_ACCESS_ROLE_ENV).length) {
    return configuredValues;
  }

  const metadata = await dataverseFetch<DataverseChoiceMetadata>(
    "/EntityDefinitions(LogicalName='drg_programaccess')/Attributes(LogicalName='drg_accessrole')/Microsoft.Dynamics.CRM.PicklistAttributeMetadata?$select=LogicalName&$expand=OptionSet($select=Options),GlobalOptionSet($select=Options)"
  );
  const options =
    metadata.OptionSet?.Options ?? metadata.GlobalOptionSet?.Options ?? [];
  const values = new Map(configuredValues);

  for (const option of options) {
    if (typeof option.Value !== "number") continue;
    const role = parseProgramAccessRole(getChoiceOptionLabel(option));
    if (!role) continue;
    values.set(role, option.Value);
  }

  return values;
}

async function getProgramAccessRoleOptionValue(role: ProgramAccessRole) {
  programAccessRoleOptionValuesPromise ??= loadProgramAccessRoleOptionValues();
  const values = await programAccessRoleOptionValuesPromise;
  const value = values.get(role);

  if (value === undefined) {
    throw new Error(
      `Could not resolve Dataverse drg_accessrole choice value for "${role}".`
    );
  }

  return value;
}

function mapAccessRow(row: DataverseProgramAccessRow): ProgramAccessRecord {
  return {
    id: row.drg_programaccessid,
    programId: row._drg_program_value ?? "",
    userId: row._drg_user_value,
    email: normalizeEmail(row.drg_email),
    displayName: getFormattedValue(row, "_drg_user_value"),
    accessRole: toProgramAccessRole(getFormattedValue(row, "drg_accessrole")),
    grantedAt: row.drg_grantedon ?? new Date().toISOString(),
    grantedByEmail: normalizeEmail(row.drg_grantedbyemail),
    isActive: row.drg_isactive !== false,
    revokedAt: row.drg_revokedon,
    revokedByEmail: normalizeEmail(row.drg_revokedbyemail),
    entraObjectId: row.drg_entraobjectid,
  };
}

async function enrichProgramAccessDisplayNames(
  access: ProgramAccessRecord[]
): Promise<ProgramAccessRecord[]> {
  const missingDisplayNameEmails = access
    .filter((entry) => !entry.displayName)
    .map((entry) => entry.email);

  if (missingDisplayNameEmails.length === 0) return access;

  const issuerTenantId = process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER?.match(
    /login\.microsoftonline\.com\/([^/]+)/
  )?.[1];
  const hasGraphCredentials = Boolean(
    (process.env.AZURE_TENANT_ID || issuerTenantId) &&
      (process.env.AZURE_GRAPH_CLIENT_ID || process.env.AUTH_MICROSOFT_ENTRA_ID_ID) &&
      (process.env.AZURE_GRAPH_CLIENT_SECRET || process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET)
  );

  if (!hasGraphCredentials) return access;

  try {
    const principals = await getEntraUserPrincipalsByEmail(missingDisplayNameEmails);
    return access.map((entry) => ({
      ...entry,
      displayName:
        entry.displayName ??
        principals.get(normalizeEmail(entry.email))?.displayName,
    }));
  } catch (error) {
    console.warn("Failed to enrich program access display names", error);
    return access;
  }
}

export async function listActiveProgramAccess(): Promise<ProgramAccessRecord[]> {
  if (!isDataverseConfigured()) {
    const programs = await new MockProgramConnector().getPrograms();
    return programs.flatMap((program) =>
      (
        (program as unknown as { accessList?: ProgramAccess[] }).accessList ??
        []
      ).map((grant, index) => ({
        ...grant,
        id: `${program.id}-${index}`,
        programId: program.id,
        accessRole: grant.accessRole ?? "External Reviewer",
        isActive: true,
      }))
    );
  }

  const rows = await listRows<DataverseProgramAccessRow>(
    "drg_programaccesses",
    "$select=drg_programaccessid,drg_email,drg_grantedon,drg_grantedbyemail,drg_isactive,_drg_program_value,_drg_user_value,drg_revokedon,drg_revokedbyemail,drg_entraobjectid,drg_accessrole&$filter=statecode eq 0 and drg_isactive eq true"
  );

  return enrichProgramAccessDisplayNames(rows.map(mapAccessRow));
}

export async function listProgramAccess(
  programId: string
): Promise<ProgramAccessRecord[]> {
  if (!isDataverseConfigured()) {
    const program = await new MockProgramConnector().getProgramById(programId);
    return (
      (program as unknown as { accessList?: ProgramAccess[] } | undefined)
        ?.accessList ?? []
    ).map((grant, index) => ({
      ...grant,
      id: `${programId}-${index}`,
      programId,
      accessRole: grant.accessRole ?? "External Reviewer",
      isActive: true,
    }));
  }

  const rows = await listRows<DataverseProgramAccessRow>(
    "drg_programaccesses",
    `$select=drg_programaccessid,drg_email,drg_grantedon,drg_grantedbyemail,drg_isactive,_drg_program_value,_drg_user_value,drg_revokedon,drg_revokedbyemail,drg_entraobjectid,drg_accessrole&$filter=statecode eq 0 and _drg_program_value eq ${programId}`
  );

  return enrichProgramAccessDisplayNames(rows.map(mapAccessRow));
}

export async function hasActiveProgramAccess(
  programId: string,
  email: string | null | undefined
) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return false;

  const access = await listProgramAccess(programId);
  return access.some((entry) => normalizeEmail(entry.email) === normalizedEmail);
}

export async function createProgramAccess(input: {
  programId: string;
  programNumber?: string;
  email: string;
  displayName?: string;
  grantedByEmail: string;
  accessRole?: ProgramAccessRole;
  entraObjectId?: string;
}) {
  const email = normalizeEmail(input.email);
  const grantedByEmail = normalizeEmail(input.grantedByEmail);

  if (!isDataverseConfigured()) {
    const existing = await listProgramAccess(input.programId);
    const matching = existing.find((entry) => entry.email === email);
    if (matching) {
      throw businessRuleError("duplicateProgramAccess");
    }

    return {
      id: `${input.programId}-${email}`,
      programId: input.programId,
      email,
      displayName: input.displayName,
      accessRole: input.accessRole ?? "External Reviewer",
      grantedAt: new Date().toISOString(),
      grantedByEmail,
      isActive: true,
    } satisfies ProgramAccessRecord;
  }

  const existing = await listProgramAccess(input.programId);
  const matching = existing.find((entry) => entry.email === email);
  if (matching) {
    throw businessRuleError("duplicateProgramAccess");
  }

  const payload: Record<string, unknown> = {
    drg_name: `${input.programNumber ?? input.programId} | ${email}`,
    "drg_program@odata.bind": lookupBind("drg_programs", input.programId),
    drg_email: email,
    drg_accessrole: await getProgramAccessRoleOptionValue(
      input.accessRole ?? "External Reviewer"
    ),
    drg_isactive: true,
    drg_grantedon: new Date().toISOString(),
    drg_grantedbyemail: grantedByEmail,
  };

  if (input.entraObjectId) {
    payload.drg_entraobjectid = input.entraObjectId;
  }

  try {
    await dataverseFetch<void>("/drg_programaccesses", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  } catch (error) {
    if (error instanceof DataverseError && error.isAlternateKeyConflict) {
      throw businessRuleError("duplicateProgramAccess");
    }

    throw error;
  }

  return {
    id: `${input.programId}-${email}`,
    programId: input.programId,
      email,
      displayName: input.displayName,
      accessRole: input.accessRole ?? "External Reviewer",
    grantedAt: new Date().toISOString(),
    grantedByEmail,
    isActive: true,
  } satisfies ProgramAccessRecord;
}

export async function revokeProgramAccess(input: {
  programId: string;
  email: string;
}) {
  if (!isDataverseConfigured()) return;

  const email = normalizeEmail(input.email);
  const rows = await listRows<DataverseProgramAccessRow>(
    "drg_programaccesses",
    `$select=drg_programaccessid&$top=1&$filter=statecode eq 0 and _drg_program_value eq ${input.programId} and drg_email eq '${escapeODataString(email)}'`
  );

  const accessId = rows[0]?.drg_programaccessid;
  if (!accessId) return;

  await dataverseFetch<void>(`/drg_programaccesses(${accessId})`, {
    method: "PATCH",
    body: JSON.stringify({
      drg_isactive: false,
    }),
  });
}
