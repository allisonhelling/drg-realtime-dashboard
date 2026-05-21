import type {
  DocumentAccessAction,
  DocumentAccessLog,
} from "@/lib/models/document";
import {
  dataverseFetch,
  escapeODataString,
  getFormattedValue,
  isDataverseConfigured,
  listRows,
  lookupBind,
} from "@/lib/dataverse/client";
import { normalizeEmail } from "@/lib/auth/roles";
import type { InternalRole } from "@/lib/auth/roles";

interface DataverseDocumentAccessLogRow extends Record<string, unknown> {
  drg_documentaccesslogid: string;
  drg_actorname?: string;
  drg_actoremail?: string;
  drg_occurredon?: string;
  _drg_document_value?: string;
  _drg_program_value?: string;
  _drg_actoruser_value?: string;
}

interface DataverseSystemUserRow {
  systemuserid: string;
}

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

const DOCUMENT_ACCESS_ACTION_ENV: Record<DocumentAccessAction, string> = {
  View: "DATAVERSE_DOCUMENT_ACCESS_ACTION_VIEW_VALUE",
  Download: "DATAVERSE_DOCUMENT_ACCESS_ACTION_DOWNLOAD_VALUE",
  Upload: "DATAVERSE_DOCUMENT_ACCESS_ACTION_UPLOAD_VALUE",
  Delete: "DATAVERSE_DOCUMENT_ACCESS_ACTION_DELETE_VALUE",
  Acknowledge: "DATAVERSE_DOCUMENT_ACCESS_ACTION_ACKNOWLEDGE_VALUE",
};

let documentAccessActionOptionValuesPromise:
  | Promise<Map<DocumentAccessAction, number>>
  | undefined;

export function shouldCreateDocumentAccessLog(input: {
  action: DocumentAccessAction;
  internalRoles: readonly InternalRole[];
}) {
  if (input.action === "Upload") return true;
  if (input.action === "View" || input.action === "Download") {
    return input.internalRoles.includes("external-reviewer");
  }

  return false;
}

function toDocumentAccessAction(value: string | undefined): DocumentAccessAction {
  switch (value) {
    case "Download":
    case "Upload":
    case "Delete":
    case "Acknowledge":
    case "View":
      return value;
    default:
      return "View";
  }
}

function getChoiceOptionLabel(option: DataverseChoiceOption) {
  return (
    option.Label?.UserLocalizedLabel?.Label ??
    option.Label?.LocalizedLabels?.find((label) => label.Label)?.Label ??
    ""
  );
}

function parseDocumentAccessAction(value: string | undefined) {
  return toDocumentAccessAction(value) === value ? value : undefined;
}

function getConfiguredActionValue(action: DocumentAccessAction) {
  const envName = DOCUMENT_ACCESS_ACTION_ENV[action];
  const raw = process.env[envName]?.trim();
  if (!raw) return undefined;

  const value = Number(raw);
  if (!Number.isInteger(value)) {
    throw new Error(`${envName} must be a Dataverse integer choice value.`);
  }

  return value;
}

async function loadDocumentAccessActionOptionValues() {
  const values = new Map<DocumentAccessAction, number>();
  for (const action of Object.keys(
    DOCUMENT_ACCESS_ACTION_ENV
  ) as DocumentAccessAction[]) {
    const configuredValue = getConfiguredActionValue(action);
    if (configuredValue !== undefined) {
      values.set(action, configuredValue);
    }
  }

  const metadata = await dataverseFetch<DataverseChoiceMetadata>(
    "/EntityDefinitions(LogicalName='drg_documentaccesslog')/Attributes(LogicalName='drg_action')/Microsoft.Dynamics.CRM.PicklistAttributeMetadata?$select=LogicalName&$expand=OptionSet($select=Options),GlobalOptionSet($select=Options)"
  );
  const options =
    metadata.OptionSet?.Options ?? metadata.GlobalOptionSet?.Options ?? [];

  for (const option of options) {
    if (typeof option.Value !== "number") continue;
    const action = parseDocumentAccessAction(getChoiceOptionLabel(option));
    if (!action) continue;
    values.set(action, option.Value);
  }

  return values;
}

async function getDocumentAccessActionOptionValue(
  action: DocumentAccessAction
) {
  documentAccessActionOptionValuesPromise ??=
    loadDocumentAccessActionOptionValues();
  const values = await documentAccessActionOptionValuesPromise;
  const value = values.get(action);

  if (value === undefined) {
    throw new Error(
      `Could not resolve Dataverse drg_action choice value for "${action}".`
    );
  }

  return value;
}

async function findSystemUserIdByEmail(email: string) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return undefined;

  const escapedEmail = escapeODataString(normalizedEmail);
  const rows = await listRows<DataverseSystemUserRow>(
    "systemusers",
    `$select=systemuserid&$top=1&$filter=internalemailaddress eq '${escapedEmail}' or domainname eq '${escapedEmail}'`
  );

  return rows[0]?.systemuserid;
}

function mapAccessLogRow(row: DataverseDocumentAccessLogRow): DocumentAccessLog {
  return {
    id: row.drg_documentaccesslogid,
    documentId: row._drg_document_value ?? "",
    programId: row._drg_program_value ?? "",
    actorUserId: row._drg_actoruser_value,
    actorName: row.drg_actorname ?? row.drg_actoremail ?? "",
    actorEmail: row.drg_actoremail ?? "",
    action: toDocumentAccessAction(getFormattedValue(row, "drg_action")),
    occurredOn: row.drg_occurredon ?? "",
  };
}

export async function listDocumentAccessLogs(
  documentIds: readonly string[]
): Promise<Map<string, DocumentAccessLog[]>> {
  const grouped = new Map<string, DocumentAccessLog[]>();
  if (!isDataverseConfigured() || documentIds.length === 0) return grouped;

  const rows = await listRows<DataverseDocumentAccessLogRow>(
    "drg_documentaccesslogs",
    "$select=drg_documentaccesslogid,drg_actorname,drg_actoremail,drg_occurredon,_drg_document_value,_drg_program_value,_drg_actoruser_value,drg_action&$filter=statecode eq 0&$orderby=drg_occurredon desc"
  );

  const allowedIds = new Set(documentIds);
  for (const row of rows) {
    const documentId = row._drg_document_value;
    if (!documentId || !allowedIds.has(documentId)) continue;

    grouped.set(documentId, [
      ...(grouped.get(documentId) ?? []),
      mapAccessLogRow(row),
    ]);
  }

  return grouped;
}

export async function listProgramDocumentAccessLogs(
  programIds: readonly string[]
): Promise<DocumentAccessLog[]> {
  if (!isDataverseConfigured() || programIds.length === 0) return [];

  const rows = await listRows<DataverseDocumentAccessLogRow>(
    "drg_documentaccesslogs",
    "$select=drg_documentaccesslogid,drg_actorname,drg_actoremail,drg_occurredon,_drg_document_value,_drg_program_value,_drg_actoruser_value,drg_action&$filter=statecode eq 0&$orderby=drg_occurredon desc"
  );
  const allowedIds = new Set(programIds);

  return rows
    .map(mapAccessLogRow)
    .filter((log) => allowedIds.has(log.programId));
}

export async function hasDocumentDownloadByActor(input: {
  documentId: string;
  actorEmail?: string | null;
}) {
  const actorEmail = normalizeEmail(input.actorEmail);
  if (!actorEmail) return false;

  const logMap = await listDocumentAccessLogs([input.documentId]);
  return (logMap.get(input.documentId) ?? []).some(
    (log) =>
      log.action === "Download" &&
      normalizeEmail(log.actorEmail) === actorEmail
  );
}

export async function createDocumentAccessLog(input: {
  documentId: string;
  programId: string;
  actorUserId?: string;
  actorName: string;
  actorEmail: string;
  action: DocumentAccessAction;
}) {
  if (!isDataverseConfigured()) return;

  const occurredOn = new Date().toISOString();
  const actorSystemUserId = await findSystemUserIdByEmail(input.actorEmail);
  const payload: Record<string, unknown> = {
    drg_name: `${input.action} | ${input.actorEmail} | ${occurredOn}`,
    "drg_document@odata.bind": lookupBind("drg_documents", input.documentId),
    "drg_program@odata.bind": lookupBind("drg_programs", input.programId),
    drg_actorname: input.actorName,
    drg_actoremail: input.actorEmail,
    drg_action: await getDocumentAccessActionOptionValue(input.action),
    drg_occurredon: occurredOn,
  };

  if (actorSystemUserId) {
    payload["drg_actoruser@odata.bind"] = lookupBind(
      "systemusers",
      actorSystemUserId
    );
  }

  await dataverseFetch<void>("/drg_documentaccesslogs", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
