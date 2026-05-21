import "server-only";
import { businessRuleError } from "@/lib/errors/business-rules";

export type FlowName = "approvalAcknowledged";

const FLOW_URLS: Record<FlowName, string | undefined> = {
  approvalAcknowledged: process.env.POWER_AUTOMATE_APPROVAL_ACKNOWLEDGED_URL,
};

export class PowerAutomateFlowError extends Error {
  readonly flowName: FlowName;
  readonly status: number;
  readonly details?: string;

  constructor(input: {
    flowName: FlowName;
    status: number;
    message: string;
    details?: string;
  }) {
    super(input.message);
    this.name = "PowerAutomateFlowError";
    this.flowName = input.flowName;
    this.status = input.status;
    this.details = input.details;
  }
}

export async function triggerFlow(
  flowName: FlowName,
  payload: Record<string, unknown>,
  options: { signal?: AbortSignal } = {}
) {
  const url = FLOW_URLS[flowName];
  if (!url) return { skipped: true };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    cache: "no-store",
    signal: options.signal,
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new PowerAutomateFlowError({
      flowName,
      status: response.status,
      message: `Power Automate flow failed: ${response.status}`,
      details,
    });
  }

  return { skipped: false };
}

export interface AcknowledgeSignedApprovalInput {
  deliverableId: string;
  acceptedSubmissionDocumentId: string;
  signedApprovalDocumentId: string;
  approvalId?: string;
  acknowledgedByEmail: string;
  acknowledgedByName?: string;
  acknowledgedByUserId?: string;
}

export async function acknowledgeSignedApprovalFlow(
  input: AcknowledgeSignedApprovalInput
) {
  if (!input.deliverableId) {
    throw new Error("Deliverable ID is required for acknowledgment.");
  }
  if (!input.acceptedSubmissionDocumentId) {
    throw businessRuleError("reviewedDocumentRequired");
  }
  if (!input.signedApprovalDocumentId) {
    throw businessRuleError("signedApprovalPdfRequired");
  }

  return triggerFlow("approvalAcknowledged", {
    deliverableId: input.deliverableId,
    acceptedSubmissionDocumentId: input.acceptedSubmissionDocumentId,
    signedApprovalDocumentId: input.signedApprovalDocumentId,
    approvalId: input.approvalId,
    acknowledgedByEmail: input.acknowledgedByEmail,
    acknowledgedByName: input.acknowledgedByName,
    acknowledgedByUserId: input.acknowledgedByUserId,
  });
}
