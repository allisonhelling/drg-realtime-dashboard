import { MockDocumentConnector } from "@/lib/connectors/mock-documents";
import type {
  DeliverableDocument,
  DocumentRole,
  DocumentStatus,
  FileType,
} from "@/lib/models/document";
import {
  dataverseFetch,
  escapeODataString,
  getFormattedValue,
  isDataverseConfigured,
  listRows,
  lookupBind,
  type DataverseUser,
} from "@/lib/dataverse/client";
import { normalizeEmail } from "@/lib/auth/roles";
import { listVisiblePrograms } from "@/lib/dataverse/programs";

interface DataverseDocumentRow extends Record<string, unknown> {
  drg_documentid: string;
  drg_name?: string;
  drg_filename?: string;
  drg_filesizekb?: number;
  drg_submissionnumber?: number;
  drg_uploadedbyemail?: string;
  drg_uploadedon?: string;
  _drg_uploadedby_value?: string;
  _drg_deliverable_value?: string;
  _drg_program_value?: string;
  _drg_parentdocument_value?: string;
  _drg_approval_value?: string;
  drg_sharepointsiteurl?: string;
  drg_sharepointdriveid?: string;
  drg_sharepointitemid?: string;
  drg_sharepointurl?: string;
  drg_versionlabel?: string;
  drg_reviewduedate?: string;
  _drg_viewedby_value?: string;
  drg_viewedbyemail?: string;
  drg_viewedon?: string;
  _drg_supersededbydocument_value?: string;
  drg_supersededon?: string;
  drg_checksum?: string;
  drg_iscurrentversion?: boolean;
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

interface DataverseSystemUserRow {
  systemuserid: string;
}

export interface CreateDocumentMetadataInput {
  programId: string;
  deliverableId: string;
  fileName: string;
  sizeKb: number;
  uploadedByEmail: string;
  description?: string;
  sharePointSiteUrl: string;
  sharePointDriveId: string;
  sharePointItemId: string;
  sharePointUrl: string;
  checksum?: string;
  documentRole?: DocumentRole;
  reviewDueDate?: string;
  parentDocumentId?: string;
  approvalId?: string;
}

const DOCUMENT_ROLE_ENV: Record<DocumentRole, string> = {
  "DRG Submission": "DATAVERSE_DOCUMENT_ROLE_DRG_SUBMISSION_VALUE",
  "Reviewer Response": "DATAVERSE_DOCUMENT_ROLE_REVIEWER_RESPONSE_VALUE",
  "Signed Approval": "DATAVERSE_DOCUMENT_ROLE_SIGNED_APPROVAL_VALUE",
};

const DOCUMENT_STATUS_ENV: Partial<Record<DocumentStatus, string>> = {
  Submitted: "DATAVERSE_DOCUMENT_STATUS_SUBMITTED_VALUE",
};

const DATAVERSE_URL_MAX_LENGTH = 100;

let documentRoleOptionValuesPromise:
  | Promise<Map<DocumentRole, number>>
  | undefined;
let documentStatusOptionValuesPromise:
  | Promise<Map<DocumentStatus, number>>
  | undefined;

function toUiFileType(fileName: string): FileType {
  const extension = fileName.split(".").pop()?.toLowerCase();
  switch (extension) {
    case "doc":
    case "docx":
      return "Word";
    case "xls":
    case "xlsx":
      return "Excel";
    case "ppt":
    case "pptx":
      return "PowerPoint";
    default:
      return "PDF";
  }
}

function toUiStatus(value: string | undefined): DocumentStatus {
  switch (value) {
    case "Submitted":
    case "Under Review":
    case "Returned":
    case "Viewed":
    case "Outdated":
    case "Overdue - Waiting on Reviewer":
    case "Final":
    case "Reviewed":
    case "Archived":
      return value;
    default:
      return "Submitted";
  }
}

function toDocumentRole(value: string | undefined): DocumentRole {
  switch (value) {
    case "Reviewer Response":
    case "Signed Approval":
    case "DRG Submission":
      return value;
    default:
      return "DRG Submission";
  }
}

function getChoiceOptionLabel(option: DataverseChoiceOption) {
  return (
    option.Label?.UserLocalizedLabel?.Label ??
    option.Label?.LocalizedLabels?.find((label) => label.Label)?.Label ??
    ""
  );
}

function parseDocumentRole(value: string | undefined) {
  return toDocumentRole(value) === value ? value : undefined;
}

function parseDocumentStatus(value: string | undefined) {
  return toUiStatus(value) === value ? value : undefined;
}

function getConfiguredChoiceValue(envName: string) {
  const raw = process.env[envName]?.trim();
  if (!raw) return undefined;

  const value = Number(raw);
  if (!Number.isInteger(value)) {
    throw new Error(`${envName} must be a Dataverse integer choice value.`);
  }

  return value;
}

function toDataverseOptionalUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > DATAVERSE_URL_MAX_LENGTH) {
    return undefined;
  }

  return trimmed;
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

async function loadChoiceOptionValues<T extends string>(input: {
  entityLogicalName: string;
  attributeLogicalName: string;
  configuredEnv: Partial<Record<T, string>>;
  parseLabel: (label: string | undefined) => T | undefined;
}) {
  const values = new Map<T, number>();
  for (const [label, envName] of Object.entries(input.configuredEnv) as Array<
    [T, string | undefined]
  >) {
    if (!envName) continue;
    const configuredValue = getConfiguredChoiceValue(envName);
    if (configuredValue !== undefined) {
      values.set(label, configuredValue);
    }
  }

  const metadata = await dataverseFetch<DataverseChoiceMetadata>(
    `/EntityDefinitions(LogicalName='${input.entityLogicalName}')/Attributes(LogicalName='${input.attributeLogicalName}')/Microsoft.Dynamics.CRM.PicklistAttributeMetadata?$select=LogicalName&$expand=OptionSet($select=Options),GlobalOptionSet($select=Options)`
  );
  const options =
    metadata.OptionSet?.Options ?? metadata.GlobalOptionSet?.Options ?? [];

  for (const option of options) {
    if (typeof option.Value !== "number") continue;
    const label = input.parseLabel(getChoiceOptionLabel(option));
    if (!label) continue;
    values.set(label, option.Value);
  }

  return values;
}

async function getDocumentRoleOptionValue(role: DocumentRole) {
  documentRoleOptionValuesPromise ??= loadChoiceOptionValues({
    entityLogicalName: "drg_document",
    attributeLogicalName: "drg_documentrole",
    configuredEnv: DOCUMENT_ROLE_ENV,
    parseLabel: parseDocumentRole,
  });
  const values = await documentRoleOptionValuesPromise;
  const value = values.get(role);

  if (value === undefined) {
    throw new Error(
      `Could not resolve Dataverse drg_documentrole choice value for "${role}".`
    );
  }

  return value;
}

async function getDocumentStatusOptionValue(status: DocumentStatus) {
  documentStatusOptionValuesPromise ??= loadChoiceOptionValues({
    entityLogicalName: "drg_document",
    attributeLogicalName: "drg_status",
    configuredEnv: DOCUMENT_STATUS_ENV,
    parseLabel: parseDocumentStatus,
  });
  const values = await documentStatusOptionValuesPromise;
  const value = values.get(status);

  if (value === undefined) {
    throw new Error(
      `Could not resolve Dataverse drg_status choice value for "${status}".`
    );
  }

  return value;
}

function normalizeMockDocument(document: DeliverableDocument): DeliverableDocument {
  const legacy = document as unknown as {
    status?: string;
  };
  const statusMap: Record<string, DocumentStatus> = {
    Draft: "Submitted",
  };

  return {
    ...document,
    name: document.name ?? document.fileName,
    submissionNumber: document.submissionNumber ?? 1,
    documentRole: document.documentRole ?? "DRG Submission",
    uploadedByEmail: document.uploadedByEmail ?? document.uploadedBy,
    sharePointSiteUrl: document.sharePointSiteUrl ?? "",
    sharePointDriveId: document.sharePointDriveId ?? "",
    sharePointItemId: document.sharePointItemId ?? document.id,
    sharePointUrl: document.sharePointUrl ?? "",
    status: statusMap[legacy.status ?? ""] ?? toUiStatus(legacy.status),
    isCurrentVersion: document.isCurrentVersion ?? true,
  };
}

function mapDocumentRow(row: DataverseDocumentRow): DeliverableDocument {
  const fileName = row.drg_filename ?? row.drg_documentid;

  return {
    id: row.drg_documentid,
    name: row.drg_name ?? fileName,
    fileName,
    fileType: toUiFileType(fileName),
    deliverableId: row._drg_deliverable_value ?? "",
    programId: row._drg_program_value ?? "",
    submissionNumber: row.drg_submissionnumber ?? 0,
    documentRole: toDocumentRole(getFormattedValue(row, "drg_documentrole")),
    parentDocumentId: row._drg_parentdocument_value,
    approvalId: row._drg_approval_value,
    sharePointSiteUrl: row.drg_sharepointsiteurl ?? "",
    sharePointDriveId: row.drg_sharepointdriveid ?? "",
    sharePointItemId: row.drg_sharepointitemid ?? "",
    sharePointUrl: row.drg_sharepointurl ?? "",
    versionLabel: row.drg_versionlabel,
    uploadedByUserId: row._drg_uploadedby_value,
    uploadedByEmail: row.drg_uploadedbyemail ?? "",
    uploadedBy:
      getFormattedValue(row, "_drg_uploadedby_value") ??
      row.drg_uploadedbyemail ??
      "",
    uploadedAt: row.drg_uploadedon ?? "",
    status: toUiStatus(getFormattedValue(row, "drg_status")),
    sizeKb: row.drg_filesizekb ?? 0,
    reviewDueDate: row.drg_reviewduedate,
    viewedByUserId: row._drg_viewedby_value,
    viewedByEmail: row.drg_viewedbyemail,
    viewedOn: row.drg_viewedon,
    supersededByDocumentId: row._drg_supersededbydocument_value,
    supersededOn: row.drg_supersededon,
    checksum: row.drg_checksum,
    isCurrentVersion: row.drg_iscurrentversion ?? true,
  };
}

export async function listDocuments(
  currentOnly = true
): Promise<DeliverableDocument[]> {
  if (!isDataverseConfigured()) {
    const documents = await new MockDocumentConnector().getDocuments();
    return documents
      .map(normalizeMockDocument)
      .filter((document) => !currentOnly || document.isCurrentVersion);
  }

  const filter = currentOnly
    ? "statecode eq 0 and drg_iscurrentversion eq true"
    : "statecode eq 0";
  const rows = await listRows<DataverseDocumentRow>(
    "drg_documents",
    `$select=drg_documentid,drg_name,drg_filename,drg_filesizekb,drg_submissionnumber,drg_uploadedbyemail,drg_uploadedon,_drg_uploadedby_value,_drg_deliverable_value,_drg_program_value,_drg_parentdocument_value,_drg_approval_value,drg_sharepointsiteurl,drg_sharepointdriveid,drg_sharepointitemid,drg_sharepointurl,drg_versionlabel,drg_reviewduedate,_drg_viewedby_value,drg_viewedbyemail,drg_viewedon,_drg_supersededbydocument_value,drg_supersededon,drg_checksum,drg_iscurrentversion,drg_documentrole,drg_status&$filter=${filter}`
  );
  return rows.map(mapDocumentRow);
}

export async function listVisibleDocuments(
  user: DataverseUser,
  options: {
    includeArchivedPrograms?: boolean;
    documentRole?: DocumentRole;
    status?: DocumentStatus;
    currentOnly?: boolean;
  } = {}
): Promise<DeliverableDocument[]> {
  const [documents, programs] = await Promise.all([
    listDocuments(options.currentOnly !== false),
    listVisiblePrograms(user, {
      includeArchived: options.includeArchivedPrograms,
    }),
  ]);
  const visibleProgramIds = new Set(programs.map((program) => program.id));

  return documents.filter((document) => {
    if (!visibleProgramIds.has(document.programId)) return false;
    if (options.documentRole && document.documentRole !== options.documentRole) {
      return false;
    }
    if (options.status && document.status !== options.status) return false;
    return true;
  });
}

export async function getVisibleDocumentById(id: string, user: DataverseUser) {
  const documents = await listVisibleDocuments(user);
  return documents.find((document) => document.id === id);
}

export async function listDocumentIdsForDeliverable(deliverableId: string) {
  if (!isDataverseConfigured()) {
    const documents = await new MockDocumentConnector().getDocuments();
    return documents
      .map(normalizeMockDocument)
      .filter((document) => document.deliverableId === deliverableId)
      .map((document) => document.id);
  }

  const rows = await listRows<Pick<DataverseDocumentRow, "drg_documentid">>(
    "drg_documents",
    `$select=drg_documentid&$filter=statecode eq 0 and _drg_deliverable_value eq ${deliverableId}`
  );

  return rows.map((row) => row.drg_documentid).filter(Boolean);
}

export async function createDocumentMetadata(input: CreateDocumentMetadataInput) {
  if (!isDataverseConfigured()) {
    throw new Error("Dataverse is not configured for document metadata writes.");
  }

  const documentRole = input.documentRole ?? "DRG Submission";
  const uploadedByUserId = await findSystemUserIdByEmail(input.uploadedByEmail);
  const payload: Record<string, unknown> = {
    drg_name: input.fileName,
    "drg_program@odata.bind": lookupBind("drg_programs", input.programId),
    "drg_deliverable@odata.bind": lookupBind("drg_deliverables", input.deliverableId),
    drg_description: input.description?.trim() || undefined,
    drg_filename: input.fileName,
    drg_filesizekb: input.sizeKb,
    drg_sharepointsiteurl: toDataverseOptionalUrl(input.sharePointSiteUrl),
    drg_sharepointdriveid: input.sharePointDriveId,
    drg_sharepointitemid: input.sharePointItemId,
    drg_sharepointurl: toDataverseOptionalUrl(input.sharePointUrl),
    drg_uploadedbyemail: input.uploadedByEmail,
    drg_uploadedon: new Date().toISOString(),
    drg_documentrole: await getDocumentRoleOptionValue(documentRole),
    drg_status: await getDocumentStatusOptionValue("Submitted"),
    drg_iscurrentversion: true,
    drg_checksum: input.checksum,
    drg_reviewduedate: input.reviewDueDate || undefined,
  };

  if (uploadedByUserId) {
    payload["drg_uploadedby@odata.bind"] = lookupBind(
      "systemusers",
      uploadedByUserId
    );
  }

  if (input.parentDocumentId) {
    payload["drg_parentdocument@odata.bind"] = lookupBind(
      "drg_documents",
      input.parentDocumentId
    );
  }

  if (input.approvalId) {
    payload["drg_approval@odata.bind"] = lookupBind(
      "drg_approvals",
      input.approvalId
    );
  }

  const response = await dataverseFetch<{ drg_documentid?: string }>("/drg_documents", {
    method: "POST",
    headers: {
      Prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  });

  if (!response.drg_documentid) {
    throw new Error("Dataverse did not return the created document ID.");
  }

  return response.drg_documentid;
}

async function listChildIdsByDocument(
  entitySetName: string,
  idColumn: string,
  documentLookupColumn: string,
  documentId: string
) {
  const rows = await listRows<Record<string, unknown>>(
    entitySetName,
    `$select=${idColumn}&$filter=statecode eq 0 and ${documentLookupColumn} eq ${documentId}`
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

export async function deleteDocumentMetadata(documentId: string) {
  if (!isDataverseConfigured()) {
    throw new Error("Dataverse is not configured for document deletion.");
  }

  const [documentApprovalIds, responseApprovalIds, accessLogIds] =
    await Promise.all([
      listChildIdsByDocument(
        "drg_approvals",
        "drg_approvalid",
        "_drg_document_value",
        documentId
      ),
      listChildIdsByDocument(
        "drg_approvals",
        "drg_approvalid",
        "_drg_responsedocument_value",
        documentId
      ),
      listChildIdsByDocument(
        "drg_documentaccesslogs",
        "drg_documentaccesslogid",
        "_drg_document_value",
        documentId
      ),
    ]);

  await deleteRows("drg_documentaccesslogs", accessLogIds);
  await deleteRows("drg_approvals", [
    ...new Set([...documentApprovalIds, ...responseApprovalIds]),
  ]);
  await dataverseFetch<void>(`/drg_documents(${documentId})`, {
    method: "DELETE",
  });
}
