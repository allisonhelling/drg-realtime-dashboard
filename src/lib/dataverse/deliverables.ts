import { MockDeliverableConnector } from "@/lib/connectors/mock-deliverables";
import type { Deliverable, DeliverableStatus } from "@/lib/models/deliverable";
import {
  dataverseFetch,
  escapeODataString,
  getFormattedValue,
  isDataverseConfigured,
  listRows,
  lookupBind,
  type DataverseUser,
} from "@/lib/dataverse/client";
import { listVisiblePrograms } from "@/lib/dataverse/programs";
import { toDeliverableTypeName } from "@/lib/dataverse/deliverable-types";
import { listDocumentIdsForDeliverable } from "@/lib/dataverse/documents";
import { normalizeEmail } from "@/lib/auth/roles";
import { businessRuleError } from "@/lib/errors/business-rules";

interface DataverseDeliverableRow extends Record<string, unknown> {
  drg_deliverableid: string;
  drg_title?: string;
  drg_deliverablenumber?: string;
  drg_contractref?: string;
  drg_description?: string;
  drg_duedate?: string;
  drg_assignedtoemail?: string;
  _drg_assignedtouser_value?: string;
  drg_lastsubmittedon?: string;
  drg_lastapprovedon?: string;
  _drg_acknowledgedby_value?: string;
  drg_acknowledgedbyemail?: string;
  drg_acknowledgedon?: string;
  drg_currentsubmissionnumber?: number;
  drg_isclosed?: boolean;
  createdon?: string;
  modifiedon?: string;
  _drg_program_value?: string;
  _drg_type_value?: string;
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

export interface CreateDeliverableInput {
  title: string;
  deliverableNumber: string;
  programId: string;
  contractRef: string;
  typeId: string;
  description?: string;
  dueDate: string;
  assignedToEmail?: string;
  status?: DeliverableStatus;
}

export interface UpdateDeliverableInput {
  deliverableId: string;
  title: string;
  description?: string;
  dueDate: string;
  assignedToEmail?: string;
}

const DELIVERABLE_STATUS_ENV: Partial<Record<DeliverableStatus, string>> = {
  Draft: "DATAVERSE_DELIVERABLE_STATUS_DRAFT_VALUE",
  "Not Submitted": "DATAVERSE_DELIVERABLE_STATUS_NOT_SUBMITTED_VALUE",
  Submitted: "DATAVERSE_DELIVERABLE_STATUS_SUBMITTED_VALUE",
  "In Review": "DATAVERSE_DELIVERABLE_STATUS_IN_REVIEW_VALUE",
  Returned: "DATAVERSE_DELIVERABLE_STATUS_RETURNED_VALUE",
  "Pending Acknowledgment":
    "DATAVERSE_DELIVERABLE_STATUS_PENDING_ACKNOWLEDGMENT_VALUE",
  Complete: "DATAVERSE_DELIVERABLE_STATUS_COMPLETE_VALUE",
};

let deliverableStatusOptionValuesPromise:
  | Promise<Map<DeliverableStatus, number>>
  | undefined;

function toUiStatus(value: string | undefined): DeliverableStatus {
  switch (value) {
    case "Draft":
    case "Not Submitted":
    case "Submitted":
    case "In Review":
    case "Returned":
    case "Pending Acknowledgment":
    case "Complete":
    case "Overdue - Waiting on Reviewer":
    case "Overdue - Waiting on DRG":
      return value;
    default:
      return "Not Submitted";
  }
}

function getChoiceOptionLabel(option: DataverseChoiceOption) {
  return (
    option.Label?.UserLocalizedLabel?.Label ??
    option.Label?.LocalizedLabels?.find((label) => label.Label)?.Label ??
    ""
  );
}

function parseDeliverableStatus(value: string | undefined) {
  return toUiStatus(value) === value ? value : undefined;
}

function getConfiguredDeliverableStatusValue(status: DeliverableStatus) {
  const envName = DELIVERABLE_STATUS_ENV[status];
  if (!envName) return undefined;

  const raw = process.env[envName]?.trim();
  if (!raw) return undefined;

  const value = Number(raw);
  if (!Number.isInteger(value)) {
    throw new Error(`${envName} must be a Dataverse integer choice value.`);
  }

  return value;
}

async function loadDeliverableStatusOptionValues() {
  const configuredValues = new Map<DeliverableStatus, number>();
  for (const status of Object.keys(DELIVERABLE_STATUS_ENV) as DeliverableStatus[]) {
    const configuredValue = getConfiguredDeliverableStatusValue(status);
    if (configuredValue !== undefined) {
      configuredValues.set(status, configuredValue);
    }
  }

  const metadata = await dataverseFetch<DataverseChoiceMetadata>(
    "/EntityDefinitions(LogicalName='drg_deliverable')/Attributes(LogicalName='drg_status')/Microsoft.Dynamics.CRM.PicklistAttributeMetadata?$select=LogicalName&$expand=OptionSet($select=Options),GlobalOptionSet($select=Options)"
  );
  const options =
    metadata.OptionSet?.Options ?? metadata.GlobalOptionSet?.Options ?? [];
  const values = new Map(configuredValues);

  for (const option of options) {
    if (typeof option.Value !== "number") continue;
    const status = parseDeliverableStatus(getChoiceOptionLabel(option));
    if (!status) continue;
    values.set(status, option.Value);
  }

  return values;
}

async function getDeliverableStatusOptionValue(status: DeliverableStatus) {
  deliverableStatusOptionValuesPromise ??= loadDeliverableStatusOptionValues();
  const values = await deliverableStatusOptionValuesPromise;
  const value = values.get(status);

  if (value === undefined) {
    throw new Error(
      `Could not resolve Dataverse drg_status choice value for "${status}".`
    );
  }

  return value;
}

function normalizeMockDeliverable(deliverable: Deliverable): Deliverable {
  const legacy = deliverable as unknown as { status?: string; type?: string };
  const statusMap: Record<string, DeliverableStatus> = {
    Draft: "Not Submitted",
    Approved: "Complete",
    Overdue: "Overdue - Waiting on Reviewer",
  };
  const type = legacy.type ?? deliverable.type ?? "CDRL";

  return {
    ...deliverable,
    deliverableNumber: deliverable.deliverableNumber ?? deliverable.id,
    type,
    typeId: deliverable.typeId ?? type,
    status: statusMap[legacy.status ?? ""] ?? toUiStatus(legacy.status),
    assignedToEmail: deliverable.assignedToEmail ?? deliverable.assignedTo,
    isClosed: deliverable.isClosed ?? false,
  };
}

function mapDeliverableRow(row: DataverseDeliverableRow): Deliverable {
  return {
    id: row.drg_deliverableid,
    title: row.drg_title ?? row.drg_deliverablenumber ?? row.drg_deliverableid,
    deliverableNumber: row.drg_deliverablenumber ?? row.drg_deliverableid,
    typeId: row._drg_type_value ?? "",
    type: toDeliverableTypeName(
      getFormattedValue(row, "_drg_type_value") ?? getFormattedValue(row, "drg_type")
    ),
    status: toUiStatus(getFormattedValue(row, "drg_status")),
    dueDate: row.drg_duedate ?? "",
    assignedToUserId: row._drg_assignedtouser_value,
    assignedToEmail: row.drg_assignedtoemail,
    assignedTo:
      getFormattedValue(row, "_drg_assignedtouser_value") ??
      row.drg_assignedtoemail ??
      "",
    programId: row._drg_program_value ?? "",
    contractRef: row.drg_contractref ?? "",
    description: row.drg_description ?? "",
    lastSubmittedOn: row.drg_lastsubmittedon,
    lastApprovedOn: row.drg_lastapprovedon,
    acknowledgedByUserId: row._drg_acknowledgedby_value,
    acknowledgedByEmail: row.drg_acknowledgedbyemail,
    acknowledgedOn: row.drg_acknowledgedon,
    currentSubmissionNumber: row.drg_currentsubmissionnumber,
    isClosed: row.drg_isclosed ?? false,
    createdOn: row.createdon,
    lastUpdated: row.modifiedon ?? "",
  };
}

export async function listDeliverables(): Promise<Deliverable[]> {
  if (!isDataverseConfigured()) {
    const deliverables = await new MockDeliverableConnector().getDeliverables();
    return deliverables.map(normalizeMockDeliverable);
  }

  const rows = await listRows<DataverseDeliverableRow>(
    "drg_deliverables",
    "$select=drg_deliverableid,drg_title,drg_deliverablenumber,drg_contractref,drg_description,drg_duedate,drg_assignedtoemail,_drg_assignedtouser_value,drg_lastsubmittedon,drg_lastapprovedon,_drg_acknowledgedby_value,drg_acknowledgedbyemail,drg_acknowledgedon,drg_currentsubmissionnumber,drg_isclosed,createdon,modifiedon,_drg_program_value,_drg_type_value,drg_status&$filter=statecode eq 0 and drg_isclosed ne true"
  );

  return rows.map(mapDeliverableRow);
}

export async function listVisibleDeliverables(
  user: DataverseUser,
  options: { includeArchivedPrograms?: boolean } = {}
): Promise<Deliverable[]> {
  const [deliverables, programs] = await Promise.all([
    listDeliverables(),
    listVisiblePrograms(user, {
      includeArchived: options.includeArchivedPrograms,
    }),
  ]);
  const visibleProgramIds = new Set(programs.map((program) => program.id));

  return deliverables.filter((deliverable) =>
    visibleProgramIds.has(deliverable.programId)
  );
}

export async function getVisibleDeliverableById(
  id: string,
  user: DataverseUser
) {
  const deliverables = await listVisibleDeliverables(user);
  return deliverables.find((deliverable) => deliverable.id === id);
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

async function listChildIdsByDeliverable(
  entitySetName: string,
  idColumn: string,
  deliverableId: string
) {
  const rows = await listRows<Record<string, unknown>>(
    entitySetName,
    `$select=${idColumn}&$filter=statecode eq 0 and _drg_deliverable_value eq ${deliverableId}`
  );

  return rows
    .map((row) => row[idColumn])
    .filter((id): id is string => typeof id === "string" && Boolean(id));
}

async function listChildIdsByDocumentIds(
  entitySetName: string,
  idColumn: string,
  documentLookupColumn: string,
  documentIds: readonly string[]
) {
  if (documentIds.length === 0) return [];

  const filter = documentIds
    .map((documentId) => `${documentLookupColumn} eq ${documentId}`)
    .join(" or ");
  const rows = await listRows<Record<string, unknown>>(
    entitySetName,
    `$select=${idColumn}&$filter=statecode eq 0 and (${filter})`
  );

  return rows
    .map((row) => row[idColumn])
    .filter((id): id is string => typeof id === "string" && Boolean(id));
}

async function deleteRows(entitySetName: string, ids: readonly string[]) {
  for (const id of ids) {
    await dataverseFetch<void>(`/${entitySetName}(${id})`, {
      method: "DELETE",
    });
  }
}

export async function createDeliverable(input: CreateDeliverableInput) {
  if (!isDataverseConfigured()) {
    throw new Error("Dataverse is not configured for deliverable creation.");
  }

  const assignedToEmail = normalizeEmail(input.assignedToEmail);
  const assignedToUserId = assignedToEmail
    ? await findSystemUserIdByEmail(assignedToEmail)
    : undefined;

  const payload: Record<string, unknown> = {
    drg_title: input.title,
    drg_deliverablenumber: input.deliverableNumber,
    "drg_program@odata.bind": lookupBind("drg_programs", input.programId),
    drg_contractref: input.contractRef,
    "drg_type@odata.bind": lookupBind("drg_deliverabletypes", input.typeId),
    drg_description: input.description ?? "",
    drg_duedate: input.dueDate,
    drg_assignedtoemail: assignedToEmail,
    drg_isclosed: false,
  };

  if (input.status && input.status !== "Not Submitted") {
    payload.drg_status = await getDeliverableStatusOptionValue(input.status);
  }

  if (assignedToUserId) {
    payload["drg_assignedtouser@odata.bind"] = lookupBind(
      "systemusers",
      assignedToUserId
    );
  }

  const response = await dataverseFetch<{ drg_deliverableid?: string }>(
    "/drg_deliverables",
    {
      method: "POST",
      headers: {
        Prefer: "return=representation",
      },
      body: JSON.stringify(payload),
    }
  );

  const deliverableId = response.drg_deliverableid;
  if (!deliverableId) {
    throw new Error("Dataverse did not return the created deliverable ID.");
  }

  return deliverableId;
}

export async function updateDeliverable(input: UpdateDeliverableInput) {
  if (!isDataverseConfigured()) {
    throw new Error("Dataverse is not configured for deliverable updates.");
  }

  const assignedToEmail = normalizeEmail(input.assignedToEmail);
  const assignedToUserId = assignedToEmail
    ? await findSystemUserIdByEmail(assignedToEmail)
    : undefined;

  const payload: Record<string, unknown> = {
    drg_title: input.title,
    drg_description: input.description ?? "",
    drg_duedate: input.dueDate,
    drg_assignedtoemail: assignedToEmail,
  };

  if (assignedToUserId) {
    payload["drg_assignedtouser@odata.bind"] = lookupBind(
      "systemusers",
      assignedToUserId
    );
  }

  await dataverseFetch<void>(`/drg_deliverables(${input.deliverableId})`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function updateDeliverableWorkflowStatus(input: {
  deliverableId: string;
  status: Extract<
    DeliverableStatus,
    "Submitted" | "In Review" | "Returned" | "Pending Acknowledgment" | "Complete"
  >;
  userEmail?: string | null;
}) {
  if (!isDataverseConfigured()) {
    throw new Error("Dataverse is not configured for deliverable status updates.");
  }

  const payload: Record<string, unknown> = {
    drg_status: await getDeliverableStatusOptionValue(input.status),
  };

  if (input.status === "In Review") {
    payload.drg_lastsubmittedon = new Date().toISOString();
  }

  if (input.status === "Pending Acknowledgment") {
    payload.drg_lastapprovedon = new Date().toISOString();
  }

  if (input.status === "Complete") {
    payload.drg_acknowledgedon = new Date().toISOString();
    payload.drg_acknowledgedbyemail = normalizeEmail(input.userEmail);
    const acknowledgedByUserId = await findSystemUserIdByEmail(input.userEmail ?? "");
    if (acknowledgedByUserId) {
      payload["drg_acknowledgedby@odata.bind"] = lookupBind(
        "systemusers",
        acknowledgedByUserId
      );
    }
  }

  await dataverseFetch<void>(`/drg_deliverables(${input.deliverableId})`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function deleteDeliverable(input: {
  deliverableId: string;
  forceWithDocuments?: boolean;
}) {
  if (!isDataverseConfigured()) {
    throw new Error("Dataverse is not configured for deliverable deletion.");
  }

  const documentIds = await listDocumentIdsForDeliverable(input.deliverableId);
  if (documentIds.length > 0 && !input.forceWithDocuments) {
    throw businessRuleError("deliverableDeleteBlocked");
  }

  const [approvalIds, documentApprovalIds, responseApprovalIds, accessLogIds] =
    await Promise.all([
      listChildIdsByDeliverable(
        "drg_approvals",
        "drg_approvalid",
        input.deliverableId
      ),
      listChildIdsByDocumentIds(
        "drg_approvals",
        "drg_approvalid",
        "_drg_document_value",
        documentIds
      ),
      listChildIdsByDocumentIds(
        "drg_approvals",
        "drg_approvalid",
        "_drg_responsedocument_value",
        documentIds
      ),
      listChildIdsByDocumentIds(
        "drg_documentaccesslogs",
        "drg_documentaccesslogid",
        "_drg_document_value",
        documentIds
      ),
    ]);

  const uniqueApprovalIds = [
    ...new Set([...approvalIds, ...documentApprovalIds, ...responseApprovalIds]),
  ];

  await deleteRows("drg_documentaccesslogs", accessLogIds);
  await deleteRows("drg_approvals", uniqueApprovalIds);
  await deleteRows("drg_documents", documentIds);
  await dataverseFetch<void>(`/drg_deliverables(${input.deliverableId})`, {
    method: "DELETE",
  });
}

export async function approveDeliverableDraft(id: string) {
  if (!isDataverseConfigured()) {
    throw new Error("Dataverse is not configured for deliverable updates.");
  }

  await dataverseFetch<void>(`/drg_deliverables(${id})`, {
    method: "PATCH",
    body: JSON.stringify({
      drg_status: await getDeliverableStatusOptionValue("Not Submitted"),
    }),
  });
}
