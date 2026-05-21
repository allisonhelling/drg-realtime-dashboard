export interface DeliverableType {
  id: string;
  name: string;
  normalizedName: string;
  isActive: boolean;
  createdByUserId?: string;
}

export const DELIVERABLE_STATUSES = [
  "Draft",
  "Not Submitted",
  "Submitted",
  "In Review",
  "Returned",
  "Pending Acknowledgment",
  "Complete",
  "Overdue - Waiting on Reviewer",
  "Overdue - Waiting on DRG",
] as const;
export type DeliverableStatus = (typeof DELIVERABLE_STATUSES)[number];

export const DELIVERABLE_ACCESS_ACTIONS = [
  "View",
  "Document Upload",
  "Document Download",
  "Review Opened",
  "Review Submitted",
  "Acknowledged",
] as const;
export type DeliverableAccessAction = (typeof DELIVERABLE_ACCESS_ACTIONS)[number];

export interface DeliverableAccessLog {
  id: string;
  deliverableId: string;
  programId: string;
  documentId?: string;
  approvalId?: string;
  actorUserId?: string;
  actorName: string;
  actorEmail: string;
  action: DeliverableAccessAction;
  source?: string;
  result?: string;
  details?: string;
  occurredOn: string;
}

export interface Deliverable {
  id: string;
  title: string;
  deliverableNumber: string;
  typeId: string;
  type: string;
  status: DeliverableStatus;
  dueDate: string;
  assignedToUserId?: string;
  assignedToEmail?: string;
  assignedTo: string;
  programId: string;
  contractRef: string;
  description: string;
  lastSubmittedOn?: string;
  lastApprovedOn?: string;
  acknowledgedByUserId?: string;
  acknowledgedByEmail?: string;
  acknowledgedOn?: string;
  currentSubmissionNumber?: number;
  isClosed: boolean;
  createdOn?: string;
  lastUpdated: string;
}
