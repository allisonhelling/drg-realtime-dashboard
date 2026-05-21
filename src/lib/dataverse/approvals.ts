import {
  canCreateApprovedDeliverable,
  canSubmitApprovalDecision,
} from "@/lib/auth/guards";
import type { InternalRole } from "@/lib/auth/roles";
import type { Approval, ApprovalDecision } from "@/lib/models/approval";
import type { Program } from "@/lib/models/program";
import {
  dataverseFetch,
  escapeODataString,
  getFormattedValue,
  isDataverseConfigured,
  listRows,
  lookupBind,
} from "@/lib/dataverse/client";
import { updateDeliverableWorkflowStatus } from "@/lib/dataverse/deliverables";
import { businessRuleError } from "@/lib/errors/business-rules";
import { listVisiblePrograms } from "@/lib/dataverse/programs";

interface DataverseApprovalRow extends Record<string, unknown> {
  drg_approvalid: string;
  drg_name?: string;
  _drg_program_value?: string;
  _drg_deliverable_value?: string;
  _drg_document_value?: string;
  drg_submissionnumber?: number;
  _drg_revieweruser_value?: string;
  drg_revieweremail?: string;
  drg_comments?: string;
  _drg_responsedocument_value?: string;
  drg_duedate?: string;
  drg_decisiondate?: string;
  drg_iscurrent?: boolean;
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

export interface SubmitApprovalDecisionInput {
  approvalId: string;
  decision: Exclude<ApprovalDecision, "Pending">;
  comments?: string;
  responseDocumentId?: string;
}

export interface SubmitApprovalDecisionForUserInput
  extends SubmitApprovalDecisionInput {
  user: { email?: string | null; internalRoles: InternalRole[] };
  program: Program;
  approval: Approval;
}

const APPROVAL_DECISION_ENV: Record<ApprovalDecision, string> = {
  Pending: "DATAVERSE_APPROVAL_DECISION_PENDING_VALUE",
  Approved: "DATAVERSE_APPROVAL_DECISION_APPROVED_VALUE",
  Rejected: "DATAVERSE_APPROVAL_DECISION_REJECTED_VALUE",
};

let approvalDecisionOptionValuesPromise:
  | Promise<Map<ApprovalDecision, number>>
  | undefined;

function toApprovalDecision(value: string | undefined): ApprovalDecision {
  switch (value) {
    case "Approved":
    case "Rejected":
    case "Pending":
      return value;
    default:
      return "Pending";
  }
}

function getChoiceOptionLabel(option: DataverseChoiceOption) {
  return (
    option.Label?.UserLocalizedLabel?.Label ??
    option.Label?.LocalizedLabels?.find((label) => label.Label)?.Label ??
    ""
  );
}

function parseApprovalDecision(value: string | undefined) {
  return toApprovalDecision(value) === value ? value : undefined;
}

function getConfiguredApprovalDecisionValue(decision: ApprovalDecision) {
  const envName = APPROVAL_DECISION_ENV[decision];
  const raw = process.env[envName]?.trim();
  if (!raw) return undefined;

  const value = Number(raw);
  if (!Number.isInteger(value)) {
    throw new Error(`${envName} must be a Dataverse integer choice value.`);
  }

  return value;
}

async function loadApprovalDecisionOptionValues() {
  const values = new Map<ApprovalDecision, number>();
  for (const decision of Object.keys(APPROVAL_DECISION_ENV) as ApprovalDecision[]) {
    const configuredValue = getConfiguredApprovalDecisionValue(decision);
    if (configuredValue !== undefined) {
      values.set(decision, configuredValue);
    }
  }

  const metadata = await dataverseFetch<DataverseChoiceMetadata>(
    "/EntityDefinitions(LogicalName='drg_approval')/Attributes(LogicalName='drg_decision')/Microsoft.Dynamics.CRM.PicklistAttributeMetadata?$select=LogicalName&$expand=OptionSet($select=Options),GlobalOptionSet($select=Options)"
  );
  const options =
    metadata.OptionSet?.Options ?? metadata.GlobalOptionSet?.Options ?? [];

  for (const option of options) {
    if (typeof option.Value !== "number") continue;
    const decision = parseApprovalDecision(getChoiceOptionLabel(option));
    if (!decision) continue;
    values.set(decision, option.Value);
  }

  return values;
}

async function getApprovalDecisionOptionValue(decision: ApprovalDecision) {
  approvalDecisionOptionValuesPromise ??= loadApprovalDecisionOptionValues();
  const values = await approvalDecisionOptionValuesPromise;
  const value = values.get(decision);

  if (value === undefined) {
    throw new Error(
      `Could not resolve Dataverse drg_decision choice value for "${decision}".`
    );
  }

  return value;
}

function mapApprovalRow(row: DataverseApprovalRow): Approval {
  return {
    id: row.drg_approvalid,
    name: row.drg_name ?? row.drg_approvalid,
    programId: row._drg_program_value ?? "",
    deliverableId: row._drg_deliverable_value ?? "",
    documentId: row._drg_document_value ?? "",
    submissionNumber: row.drg_submissionnumber ?? 0,
    reviewerUserId: row._drg_revieweruser_value,
    reviewerEmail: row.drg_revieweremail ?? "",
    decision: toApprovalDecision(getFormattedValue(row, "drg_decision")),
    comments: row.drg_comments,
    responseDocumentId: row._drg_responsedocument_value,
    dueDate: row.drg_duedate,
    decisionDate: row.drg_decisiondate,
    isCurrent: row.drg_iscurrent ?? false,
  };
}

export async function getApprovalById(id: string): Promise<Approval | undefined> {
  if (!isDataverseConfigured()) return undefined;

  const rows = await listRows<DataverseApprovalRow>(
    "drg_approvals",
    `$select=drg_approvalid,drg_name,_drg_program_value,_drg_deliverable_value,_drg_document_value,drg_submissionnumber,_drg_revieweruser_value,drg_revieweremail,drg_comments,_drg_responsedocument_value,drg_duedate,drg_decisiondate,drg_iscurrent,drg_decision&$filter=statecode eq 0 and drg_approvalid eq ${id}&$top=1`
  );

  return rows[0] ? mapApprovalRow(rows[0]) : undefined;
}

export async function listVisibleApprovals(user: {
  email?: string | null;
  internalRoles: InternalRole[];
}): Promise<Approval[]> {
  if (!isDataverseConfigured()) return [];

  const reviewerEmail = escapeODataString(String(user.email ?? "").trim().toLowerCase());
  const filter = user.internalRoles.includes("external-reviewer")
    ? `statecode eq 0 and drg_iscurrent eq true and drg_revieweremail eq '${reviewerEmail}'`
    : "statecode eq 0 and drg_iscurrent eq true";

  const rows = await listRows<DataverseApprovalRow>(
    "drg_approvals",
    `$select=drg_approvalid,drg_name,_drg_program_value,_drg_deliverable_value,_drg_document_value,drg_submissionnumber,_drg_revieweruser_value,drg_revieweremail,drg_comments,_drg_responsedocument_value,drg_duedate,drg_decisiondate,drg_iscurrent,drg_decision&$filter=${filter}&$orderby=drg_duedate asc`
  );

  const approvals = rows.map(mapApprovalRow);
  const programs = await listVisiblePrograms(user);
  const visibleProgramIds = new Set(programs.map((program) => program.id));

  return approvals.filter((approval) => visibleProgramIds.has(approval.programId));
}

async function patchApprovalDecision(input: SubmitApprovalDecisionInput) {
  if (!isDataverseConfigured()) {
    throw new Error("Dataverse is not configured for approval writes.");
  }

  const payload: Record<string, unknown> = {
    drg_decision: await getApprovalDecisionOptionValue(input.decision),
    drg_comments: input.comments,
    drg_decisiondate: new Date().toISOString(),
  };

  if (input.responseDocumentId) {
    payload["drg_responsedocument@odata.bind"] = lookupBind(
      "drg_documents",
      input.responseDocumentId
    );
  }

  await dataverseFetch<void>(`/drg_approvals(${input.approvalId})`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function submitApprovalDecision(input: SubmitApprovalDecisionForUserInput) {
  if (!canSubmitApprovalDecision(input.user, input.program, input.approval)) {
    throw businessRuleError("reviewerAccessRequired");
  }
  if (input.decision === "Rejected" && !input.comments?.trim()) {
    throw businessRuleError("rejectionCommentsRequired");
  }
  if (input.decision === "Approved" && !input.responseDocumentId) {
    throw businessRuleError("signedApprovalPdfRequired");
  }

  await patchApprovalDecision(input);
  await updateDeliverableWorkflowStatus({
    deliverableId: input.approval.deliverableId,
    status:
      input.decision === "Approved" ? "Pending Acknowledgment" : "Returned",
  });
}

export async function acknowledgeApproval(input: {
  user: { email?: string | null; internalRoles: InternalRole[] };
  program: Program;
  approval: Approval;
}) {
  if (!input.approval.isCurrent) {
    throw new Error("Only current approvals can be acknowledged.");
  }
  if (input.approval.programId !== input.program.id) {
    throw new Error("Approval does not belong to this program.");
  }
  if (input.program.status === "Archived") {
    throw new Error("Archived programs cannot be acknowledged.");
  }
  if (!canCreateApprovedDeliverable(input.user, input.program)) {
    throw new Error("You are not authorized to acknowledge this approval.");
  }

  await updateDeliverableWorkflowStatus({
    deliverableId: input.approval.deliverableId,
    status: "Complete",
    userEmail: input.user.email,
  });
}
