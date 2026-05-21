import { NextResponse } from "next/server";
import { DataverseError } from "@/lib/dataverse/client";

export const BUSINESS_RULE_MESSAGES = {
  duplicateProgramNumber:
    "A program with this program number already exists.",
  duplicateDeliverableNumber:
    "A deliverable with this deliverable number already exists for this program.",
  duplicateDeliverableType:
    "A deliverable type with this name already exists.",
  duplicateProgramAccess:
    "This user already has program access. Update the existing access row instead of creating a duplicate.",
  externalUserNotReady:
    "Collaborator or reviewer must already exist in Entra and belong to the program owner, DRG staff, or external reviewer group before program access can be granted.",
  archivedProgramUploadBlocked:
    "This program is archived. Downloads remain available, but new uploads are blocked.",
  programDeleteBlocked:
    "Only empty test programs can be deleted. Remove or archive programs with deliverables, documents, approvals, or audit logs instead.",
  deliverableDeleteBlocked:
    "Only DRG admins or this program's owner can delete deliverables.",
  pdfRequired: "Only PDF files can be uploaded.",
  reviewedDocumentRequired:
    "A reviewed submission document is required for this action.",
  reviewedDocumentDownloadRequired:
    "Download the submitted document before submitting a review decision.",
  rejectionCommentsRequired:
    "Rejection comments are required when returning a submission.",
  signedApprovalPdfRequired:
    "A Signed Approval PDF is required before this approval can be completed.",
  reviewerAccessRequired:
    "Only the current assigned reviewer with active program access can submit this approval decision.",
} as const;

export type BusinessRuleCode = keyof typeof BUSINESS_RULE_MESSAGES;

const BUSINESS_RULE_STATUS: Record<BusinessRuleCode, number> = {
  duplicateProgramNumber: 409,
  duplicateDeliverableNumber: 409,
  duplicateDeliverableType: 409,
  duplicateProgramAccess: 409,
  externalUserNotReady: 400,
  archivedProgramUploadBlocked: 403,
  programDeleteBlocked: 409,
  deliverableDeleteBlocked: 409,
  pdfRequired: 400,
  reviewedDocumentRequired: 400,
  reviewedDocumentDownloadRequired: 409,
  rejectionCommentsRequired: 400,
  signedApprovalPdfRequired: 400,
  reviewerAccessRequired: 403,
};

const BUSINESS_RULE_PATTERNS: Array<{
  code: BusinessRuleCode;
  patterns: RegExp[];
}> = [
  {
    code: "duplicateProgramNumber",
    patterns: [/duplicate program/i, /program number.*already exists/i],
  },
  {
    code: "duplicateDeliverableNumber",
    patterns: [
      /duplicate deliverable/i,
      /deliverable number.*already exists/i,
      /deliverable.*already exists.*program/i,
    ],
  },
  {
    code: "duplicateDeliverableType",
    patterns: [/duplicate deliverable type/i, /deliverable type.*already exists/i],
  },
  {
    code: "duplicateProgramAccess",
    patterns: [/duplicate program access/i, /already has (?:active )?program access/i, /already has access to this program/i],
  },
  {
    code: "externalUserNotReady",
    patterns: [
      /external user not ready/i,
      /external reviewer.*entra group/i,
      /external_user group/i,
      /collaborator.*reviewer.*entra/i,
    ],
  },
  {
    code: "archivedProgramUploadBlocked",
    patterns: [/archived program upload/i, /program is archived/i],
  },
  {
    code: "programDeleteBlocked",
    patterns: [/program delete blocked/i, /only empty test programs can be deleted/i],
  },
  {
    code: "deliverableDeleteBlocked",
    patterns: [/deliverable delete blocked/i, /program's owner can delete deliverables/i],
  },
  {
    code: "pdfRequired",
    patterns: [/pdf (?:file )?is required/i, /only pdf files can be uploaded/i, /content-type.*application\/pdf/i],
  },
  {
    code: "reviewedDocumentRequired",
    patterns: [/reviewed document required/i, /reviewed submission document/i, /parentdocument/i, /accepted submission document/i],
  },
  {
    code: "reviewedDocumentDownloadRequired",
    patterns: [/download.*submitted document/i, /submitted document.*download/i],
  },
  {
    code: "rejectionCommentsRequired",
    patterns: [/rejection (?:reason|comments?) required/i, /comments?.*required.*reject/i, /enter a reason before rejecting/i],
  },
  {
    code: "signedApprovalPdfRequired",
    patterns: [/signed (?:approval )?pdf required/i, /signed approval.*required/i, /upload the signed approval pdf/i],
  },
  {
    code: "reviewerAccessRequired",
    patterns: [/reviewer access required/i, /active reviewer access/i, /current assigned reviewer/i, /not authorized to submit this approval decision/i],
  },
];

function getErrorSearchText(error: unknown) {
  if (error instanceof Error) {
    const details =
      "details" in error && typeof error.details === "string"
        ? error.details
        : "";
    return `${error.name} ${error.message} ${details}`;
  }

  return typeof error === "string" ? error : "";
}

export function statusForBusinessRule(code: BusinessRuleCode) {
  return BUSINESS_RULE_STATUS[code];
}

export class BusinessRuleError extends Error {
  readonly code: BusinessRuleCode;
  readonly status: number;

  constructor(code: BusinessRuleCode, status = statusForBusinessRule(code)) {
    super(BUSINESS_RULE_MESSAGES[code]);
    this.name = "BusinessRuleError";
    this.code = code;
    this.status = status;
  }
}

export function businessRuleError(
  code: BusinessRuleCode,
  status = statusForBusinessRule(code)
) {
  return new BusinessRuleError(code, status);
}

export function businessRuleResponse(
  code: BusinessRuleCode,
  status = statusForBusinessRule(code)
) {
  return NextResponse.json(
    { error: BUSINESS_RULE_MESSAGES[code], code },
    { status }
  );
}

export function getBusinessRuleCodeFromError(
  error: unknown,
    duplicateConflict?: Extract<
      BusinessRuleCode,
      | "duplicateProgramNumber"
      | "duplicateDeliverableNumber"
      | "duplicateDeliverableType"
      | "duplicateProgramAccess"
    >
): BusinessRuleCode | undefined {
  if (error instanceof BusinessRuleError) return error.code;

  if (
    duplicateConflict &&
    error instanceof DataverseError &&
    error.isAlternateKeyConflict
  ) {
    return duplicateConflict;
  }

  const text = getErrorSearchText(error);
  return BUSINESS_RULE_PATTERNS.find(({ patterns }) =>
    patterns.some((pattern) => pattern.test(text))
  )?.code;
}

export function errorResponse(
  error: unknown,
  options: {
    fallback: string;
    status?: number;
    duplicateConflict?: Extract<
      BusinessRuleCode,
      | "duplicateProgramNumber"
      | "duplicateDeliverableNumber"
      | "duplicateDeliverableType"
      | "duplicateProgramAccess"
    >;
  }
) {
  const code = getBusinessRuleCodeFromError(error, options.duplicateConflict);
  if (code) {
    return businessRuleResponse(
      code,
      error instanceof BusinessRuleError
        ? error.status
        : statusForBusinessRule(code)
    );
  }

  return NextResponse.json(
    {
      error: error instanceof Error ? error.message : options.fallback,
      code: "unexpectedFailure",
    },
    { status: options.status ?? 500 }
  );
}
