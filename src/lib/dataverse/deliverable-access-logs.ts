import type {
  DeliverableAccessAction,
  DeliverableAccessLog,
} from "@/lib/models/deliverable";
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

interface DataverseDeliverableAccessLogRow extends Record<string, unknown> {
  drg_deliverableaccesslogid: string;
  drg_actorname?: string;
  drg_actoremail?: string;
  drg_occurredon?: string;
  drg_source?: string;
  drg_result?: string;
  drg_details?: string;
  _drg_deliverable_value?: string;
  _drg_program_value?: string;
  _drg_document_value?: string;
  _drg_approval_value?: string;
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

type DataverseAttributesResponse = {
  value?: Array<{
    LogicalName?: string;
  }>;
};

const DELIVERABLE_ACCESS_ACTION_ENV: Record<DeliverableAccessAction, string> = {
  View: "DATAVERSE_DELIVERABLE_ACCESS_ACTION_VIEW_VALUE",
  "Document Upload": "DATAVERSE_DELIVERABLE_ACCESS_ACTION_DOCUMENT_UPLOAD_VALUE",
  "Document Download": "DATAVERSE_DELIVERABLE_ACCESS_ACTION_DOCUMENT_DOWNLOAD_VALUE",
  "Review Opened": "DATAVERSE_DELIVERABLE_ACCESS_ACTION_REVIEW_OPENED_VALUE",
  "Review Submitted": "DATAVERSE_DELIVERABLE_ACCESS_ACTION_REVIEW_SUBMITTED_VALUE",
  Acknowledged: "DATAVERSE_DELIVERABLE_ACCESS_ACTION_ACKNOWLEDGED_VALUE",
};

let deliverableAccessActionOptionValuesPromise:
  | Promise<Map<DeliverableAccessAction, number>>
  | undefined;
let deliverableAccessLogAttributesPromise: Promise<Set<string>> | undefined;

export function shouldCreateDeliverableAccessLog(input: {
  action: DeliverableAccessAction;
  internalRoles: readonly InternalRole[];
}) {
  if (input.action === "Document Upload" || input.action === "Document Download") {
    return true;
  }

  if (input.action === "View") {
    return input.internalRoles.includes("external-reviewer");
  }

  return false;
}

function toDeliverableAccessAction(
  value: string | undefined
): DeliverableAccessAction {
  switch (value) {
    case "Document Upload":
    case "Document Download":
    case "Review Opened":
    case "Review Submitted":
    case "Acknowledged":
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

function parseDeliverableAccessAction(value: string | undefined) {
  return toDeliverableAccessAction(value) === value ? value : undefined;
}

function getConfiguredActionValue(action: DeliverableAccessAction) {
  const envName = DELIVERABLE_ACCESS_ACTION_ENV[action];
  const raw = process.env[envName]?.trim();
  if (!raw) return undefined;

  const value = Number(raw);
  if (!Number.isInteger(value)) {
    throw new Error(`${envName} must be a Dataverse integer choice value.`);
  }

  return value;
}

async function loadDeliverableAccessActionOptionValues() {
  const values = new Map<DeliverableAccessAction, number>();
  for (const action of Object.keys(
    DELIVERABLE_ACCESS_ACTION_ENV
  ) as DeliverableAccessAction[]) {
    const configuredValue = getConfiguredActionValue(action);
    if (configuredValue !== undefined) {
      values.set(action, configuredValue);
    }
  }

  const metadata = await dataverseFetch<DataverseChoiceMetadata>(
    "/EntityDefinitions(LogicalName='drg_deliverableaccesslog')/Attributes(LogicalName='drg_action')/Microsoft.Dynamics.CRM.PicklistAttributeMetadata?$select=LogicalName&$expand=OptionSet($select=Options),GlobalOptionSet($select=Options)"
  );
  const options =
    metadata.OptionSet?.Options ?? metadata.GlobalOptionSet?.Options ?? [];

  for (const option of options) {
    if (typeof option.Value !== "number") continue;
    const action = parseDeliverableAccessAction(getChoiceOptionLabel(option));
    if (!action) continue;
    values.set(action, option.Value);
  }

  return values;
}

async function getDeliverableAccessActionOptionValue(
  action: DeliverableAccessAction
) {
  deliverableAccessActionOptionValuesPromise ??=
    loadDeliverableAccessActionOptionValues();
  const values = await deliverableAccessActionOptionValuesPromise;
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

async function getDeliverableAccessLogAttributes() {
  deliverableAccessLogAttributesPromise ??=
    dataverseFetch<DataverseAttributesResponse>(
      "/EntityDefinitions(LogicalName='drg_deliverableaccesslog')/Attributes?$select=LogicalName"
    ).then(
      (response) =>
        new Set(
          response.value
            ?.map((attribute) => attribute.LogicalName)
            .filter((name): name is string => Boolean(name)) ?? []
        )
    );

  return deliverableAccessLogAttributesPromise;
}

function mapAccessLogRow(
  row: DataverseDeliverableAccessLogRow
): DeliverableAccessLog {
  return {
    id: row.drg_deliverableaccesslogid,
    deliverableId: row._drg_deliverable_value ?? "",
    programId: row._drg_program_value ?? "",
    documentId: row._drg_document_value,
    approvalId: row._drg_approval_value,
    actorUserId: row._drg_actoruser_value,
    actorName: row.drg_actorname ?? row.drg_actoremail ?? "",
    actorEmail: row.drg_actoremail ?? "",
    action: toDeliverableAccessAction(getFormattedValue(row, "drg_action")),
    source: getFormattedValue(row, "drg_source") ?? row.drg_source,
    result: getFormattedValue(row, "drg_result") ?? row.drg_result,
    details: row.drg_details,
    occurredOn: row.drg_occurredon ?? "",
  };
}

export async function listDeliverableAccessLogs(
  deliverableIds: readonly string[]
): Promise<Map<string, DeliverableAccessLog[]>> {
  const grouped = new Map<string, DeliverableAccessLog[]>();
  if (!isDataverseConfigured() || deliverableIds.length === 0) return grouped;

  const attributes = await getDeliverableAccessLogAttributes();
  const selectColumns = [
    "drg_deliverableaccesslogid",
    "drg_actorname",
    "drg_actoremail",
    "drg_occurredon",
    "_drg_deliverable_value",
    "_drg_program_value",
    "_drg_actoruser_value",
    "drg_action",
  ];

  if (attributes.has("drg_source")) selectColumns.push("drg_source");
  if (attributes.has("drg_result")) selectColumns.push("drg_result");
  if (attributes.has("drg_details")) selectColumns.push("drg_details");
  if (attributes.has("drg_document")) {
    selectColumns.push("_drg_document_value");
  }
  if (attributes.has("drg_approval")) {
    selectColumns.push("_drg_approval_value");
  }

  const rows = await listRows<DataverseDeliverableAccessLogRow>(
    "drg_deliverableaccesslogs",
    `$select=${selectColumns.join(",")}&$filter=statecode eq 0&$orderby=drg_occurredon desc`
  );

  const allowedIds = new Set(deliverableIds);
  for (const row of rows) {
    const deliverableId = row._drg_deliverable_value;
    if (!deliverableId || !allowedIds.has(deliverableId)) continue;

    grouped.set(deliverableId, [
      ...(grouped.get(deliverableId) ?? []),
      mapAccessLogRow(row),
    ]);
  }

  return grouped;
}

export async function hasDeliverableDocumentDownloadByActor(input: {
  deliverableId: string;
  documentId: string;
  approvalId?: string;
  actorEmail?: string | null;
}) {
  const actorEmail = normalizeEmail(input.actorEmail);
  if (!actorEmail) return false;

  const logMap = await listDeliverableAccessLogs([input.deliverableId]);
  return (logMap.get(input.deliverableId) ?? []).some((log) => {
    if (
      log.action !== "Document Download" ||
      normalizeEmail(log.actorEmail) !== actorEmail
    ) {
      return false;
    }

    if (log.documentId) return log.documentId === input.documentId;
    if (input.approvalId && log.approvalId) {
      return log.approvalId === input.approvalId;
    }

    return false;
  });
}

export async function createDeliverableAccessLog(input: {
  deliverableId: string;
  programId: string;
  documentId?: string;
  approvalId?: string;
  actorUserId?: string;
  actorName: string;
  actorEmail: string;
  action: DeliverableAccessAction;
  source?: string;
  details?: string;
}) {
  if (!isDataverseConfigured()) return;

  const occurredOn = new Date().toISOString();
  const attributes = await getDeliverableAccessLogAttributes();
  const actorSystemUserId = await findSystemUserIdByEmail(input.actorEmail);
  const payload: Record<string, unknown> = {
    drg_name: `${input.action} | ${input.actorEmail} | ${occurredOn}`,
    "drg_deliverable@odata.bind": lookupBind(
      "drg_deliverables",
      input.deliverableId
    ),
    "drg_program@odata.bind": lookupBind("drg_programs", input.programId),
    drg_actorname: input.actorName,
    drg_actoremail: input.actorEmail,
    drg_action: await getDeliverableAccessActionOptionValue(input.action),
    drg_occurredon: occurredOn,
  };

  if (input.documentId && attributes.has("drg_document")) {
    payload["drg_document@odata.bind"] = lookupBind(
      "drg_documents",
      input.documentId
    );
  }

  if (input.approvalId && attributes.has("drg_approval")) {
    payload["drg_approval@odata.bind"] = lookupBind(
      "drg_approvals",
      input.approvalId
    );
  }

  if (actorSystemUserId) {
    payload["drg_actoruser@odata.bind"] = lookupBind(
      "systemusers",
      actorSystemUserId
    );
  }

  await dataverseFetch<void>("/drg_deliverableaccesslogs", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
