import { normalizeEmail, type InternalRole } from "@/lib/auth/roles";
import { listVisibleApprovals } from "@/lib/dataverse/approvals";
import { listVisibleDeliverables } from "@/lib/dataverse/deliverables";
import { listVisibleDocuments } from "@/lib/dataverse/documents";
import { listVisiblePrograms } from "@/lib/dataverse/programs";
import type { DataverseUser } from "@/lib/dataverse/client";
import type { Deliverable } from "@/lib/models/deliverable";
import type { DeliverableDocument, DocumentRole } from "@/lib/models/document";
import type { Program } from "@/lib/models/program";

type AnalyticsUser = DataverseUser & {
  internalRoles: InternalRole[];
};

export type AnalyticsFilters = {
  startDate?: string;
  endDate?: string;
  programId?: string;
  user?: string;
  deliverableType?: string;
  status?: string;
  documentRole?: DocumentRole;
};

export type AnalyticsStat = {
  label: string;
  value: number;
};

export type UserAnalyticsRow = {
  email: string;
  name: string;
  documentsSubmitted: number;
  projectsInvolved: number;
  assignedDeliverables: number;
  completedDeliverables: number;
};

export type ProgramAnalyticsRow = {
  id: string;
  name: string;
  programNumber: string;
  documentsSubmitted: number;
  deliverablesCreated: number;
  deliverablesCompleted: number;
  pendingReview: number;
  overdue: number;
};

export type DeliverableTypeAnalyticsRow = {
  type: string;
  total: number;
  completed: number;
};

export type MonthlySubmissionRow = {
  month: string;
  documentsSubmitted: number;
};

export type AnalyticsOverview = {
  filters: Required<Pick<AnalyticsFilters, "startDate" | "endDate">> &
    Omit<AnalyticsFilters, "startDate" | "endDate">;
  stats: AnalyticsStat[];
  userAnalytics: UserAnalyticsRow[];
  programAnalytics: ProgramAnalyticsRow[];
  deliverableTypeAnalytics: DeliverableTypeAnalyticsRow[];
  monthlySubmissions: MonthlySubmissionRow[];
  programs: Array<Pick<Program, "id" | "name" | "programNumber">>;
  users: Array<Pick<UserAnalyticsRow, "email" | "name">>;
  deliverableTypes: string[];
};

const COMPLETE_STATUSES = new Set(["Complete", "Final", "Reviewed", "Approved"]);
const PENDING_REVIEW_STATUSES = new Set(["Submitted", "In Review", "Under Review"]);

function currentYearRange() {
  const year = new Date().getFullYear();
  return {
    startDate: `${year}-01-01`,
    endDate: `${year}-12-31`,
  };
}

function parseDate(value: string | undefined, endOfDay = false) {
  if (!value) return undefined;
  const date = new Date(`${value.slice(0, 10)}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(date.valueOf()) ? undefined : date;
}

function isWithinRange(value: string | undefined, start: Date, end: Date) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return false;
  return date >= start && date <= end;
}

function matchesTextFilter(value: string | undefined, filter: string | undefined) {
  if (!filter) return true;
  return (value ?? "").toLowerCase().includes(filter.toLowerCase());
}

function getDocumentUserKey(document: DeliverableDocument) {
  return normalizeEmail(document.uploadedByEmail) || document.uploadedBy;
}

function getUserNameFromEmail(email: string) {
  const localPart = email.split("@")[0] ?? email;
  return localPart
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function addUser(
  users: Map<string, UserAnalyticsRow>,
  key: string | undefined,
  name: string | undefined
) {
  const normalizedKey = normalizeEmail(key) || key?.trim();
  if (!normalizedKey) return undefined;

  if (!users.has(normalizedKey)) {
    users.set(normalizedKey, {
      email: normalizedKey.includes("@") ? normalizedKey : "",
      name: name?.trim() || getUserNameFromEmail(normalizedKey),
      documentsSubmitted: 0,
      projectsInvolved: 0,
      assignedDeliverables: 0,
      completedDeliverables: 0,
    });
  }

  return users.get(normalizedKey);
}

function getCompletionDate(deliverable: Deliverable) {
  return (
    deliverable.acknowledgedOn ??
    deliverable.lastApprovedOn ??
    deliverable.lastSubmittedOn ??
    deliverable.lastUpdated
  );
}

function getCreatedDate(deliverable: Deliverable) {
  return deliverable.createdOn ?? deliverable.lastUpdated;
}

function filterDocuments(
  documents: DeliverableDocument[],
  filters: AnalyticsFilters,
  start: Date,
  end: Date
) {
  return documents.filter((document) => {
    if (filters.programId && document.programId !== filters.programId) return false;
    if (filters.documentRole && document.documentRole !== filters.documentRole) return false;
    if (filters.status && document.status !== filters.status) return false;
    if (
      filters.user &&
      !matchesTextFilter(document.uploadedByEmail || document.uploadedBy, filters.user) &&
      !matchesTextFilter(document.uploadedBy, filters.user)
    ) {
      return false;
    }
    return isWithinRange(document.uploadedAt, start, end);
  });
}

function filterDeliverables(
  deliverables: Deliverable[],
  filters: AnalyticsFilters,
  start: Date,
  end: Date
) {
  return deliverables.filter((deliverable) => {
    if (filters.programId && deliverable.programId !== filters.programId) return false;
    if (filters.deliverableType && deliverable.type !== filters.deliverableType) {
      return false;
    }
    if (filters.status && deliverable.status !== filters.status) return false;
    if (
      filters.user &&
      !matchesTextFilter(deliverable.assignedToEmail || deliverable.assignedTo, filters.user) &&
      !matchesTextFilter(deliverable.assignedTo, filters.user) &&
      !matchesTextFilter(deliverable.acknowledgedByEmail, filters.user)
    ) {
      return false;
    }

    return (
      isWithinRange(getCreatedDate(deliverable), start, end) ||
      isWithinRange(deliverable.lastSubmittedOn, start, end) ||
      isWithinRange(getCompletionDate(deliverable), start, end) ||
      isWithinRange(deliverable.dueDate, start, end)
    );
  });
}

export function normalizeAnalyticsFilters(filters: AnalyticsFilters = {}) {
  const defaults = currentYearRange();
  const startDate = filters.startDate || defaults.startDate;
  const endDate = filters.endDate || defaults.endDate;

  return {
    ...filters,
    startDate,
    endDate,
  };
}

export async function getAnalyticsOverview(
  user: AnalyticsUser,
  inputFilters: AnalyticsFilters = {}
): Promise<AnalyticsOverview> {
  const filters = normalizeAnalyticsFilters(inputFilters);
  const start = parseDate(filters.startDate) ?? parseDate(currentYearRange().startDate)!;
  const end = parseDate(filters.endDate, true) ?? parseDate(currentYearRange().endDate, true)!;

  const [programs, documents, deliverables, approvals] = await Promise.all([
    listVisiblePrograms(user, { includeArchived: true }),
    listVisibleDocuments(user, {
      includeArchivedPrograms: true,
      currentOnly: false,
    }),
    listVisibleDeliverables(user, { includeArchivedPrograms: true }),
    listVisibleApprovals(user).catch(() => []),
  ]);

  const documentsInRange = filterDocuments(documents, filters, start, end);
  const deliverablesInRange = filterDeliverables(deliverables, filters, start, end);
  const completedDeliverables = deliverablesInRange.filter(
    (deliverable) =>
      COMPLETE_STATUSES.has(deliverable.status) &&
      isWithinRange(getCompletionDate(deliverable), start, end)
  );
  const pendingReview = deliverablesInRange.filter((deliverable) =>
    PENDING_REVIEW_STATUSES.has(deliverable.status)
  );
  const overdue = deliverablesInRange.filter((deliverable) =>
    deliverable.status.startsWith("Overdue")
  );

  const userRows = new Map<string, UserAnalyticsRow>();
  const userProjects = new Map<string, Set<string>>();

  for (const document of documentsInRange) {
    const row = addUser(userRows, getDocumentUserKey(document), document.uploadedBy);
    if (!row) continue;
    row.documentsSubmitted += 1;
    userProjects.set(row.email || row.name, userProjects.get(row.email || row.name) ?? new Set());
    userProjects.get(row.email || row.name)?.add(document.programId);
  }

  for (const deliverable of deliverablesInRange) {
    const assigned = addUser(
      userRows,
      deliverable.assignedToEmail || deliverable.assignedTo,
      deliverable.assignedTo
    );
    if (assigned) {
      assigned.assignedDeliverables += 1;
      if (COMPLETE_STATUSES.has(deliverable.status)) assigned.completedDeliverables += 1;
      const key = assigned.email || assigned.name;
      userProjects.set(key, userProjects.get(key) ?? new Set());
      userProjects.get(key)?.add(deliverable.programId);
    }

    const acknowledger = addUser(
      userRows,
      deliverable.acknowledgedByEmail,
      deliverable.acknowledgedByEmail
    );
    if (acknowledger) {
      const key = acknowledger.email || acknowledger.name;
      userProjects.set(key, userProjects.get(key) ?? new Set());
      userProjects.get(key)?.add(deliverable.programId);
    }
  }

  for (const program of programs) {
    if (filters.programId && program.id !== filters.programId) continue;
    for (const entry of program.access) {
      if (!entry.isActive) continue;
      const row = addUser(userRows, entry.email, entry.displayName || entry.email);
      if (!row) continue;
      const key = row.email || row.name;
      userProjects.set(key, userProjects.get(key) ?? new Set());
      userProjects.get(key)?.add(program.id);
    }
  }

  for (const approval of approvals) {
    if (filters.programId && approval.programId !== filters.programId) continue;
    const row = addUser(userRows, approval.reviewerEmail, approval.reviewerEmail);
    if (!row) continue;
    const key = row.email || row.name;
    userProjects.set(key, userProjects.get(key) ?? new Set());
    userProjects.get(key)?.add(approval.programId);
  }

  for (const [key, projects] of userProjects.entries()) {
    const row = userRows.get(key);
    if (row) row.projectsInvolved = projects.size;
  }

  const programAnalytics = programs
    .filter((program) => !filters.programId || program.id === filters.programId)
    .map<ProgramAnalyticsRow>((program) => {
      const programDeliverables = deliverablesInRange.filter(
        (deliverable) => deliverable.programId === program.id
      );
      return {
        id: program.id,
        name: program.name,
        programNumber: program.programNumber,
        documentsSubmitted: documentsInRange.filter(
          (document) => document.programId === program.id
        ).length,
        deliverablesCreated: programDeliverables.filter((deliverable) =>
          isWithinRange(getCreatedDate(deliverable), start, end)
        ).length,
        deliverablesCompleted: programDeliverables.filter(
          (deliverable) =>
            COMPLETE_STATUSES.has(deliverable.status) &&
            isWithinRange(getCompletionDate(deliverable), start, end)
        ).length,
        pendingReview: programDeliverables.filter((deliverable) =>
          PENDING_REVIEW_STATUSES.has(deliverable.status)
        ).length,
        overdue: programDeliverables.filter((deliverable) =>
          deliverable.status.startsWith("Overdue")
        ).length,
      };
    })
    .filter(
      (program) =>
        program.documentsSubmitted ||
        program.deliverablesCreated ||
        program.deliverablesCompleted ||
        program.pendingReview ||
        program.overdue
    );

  const typeMap = new Map<string, DeliverableTypeAnalyticsRow>();
  for (const deliverable of deliverablesInRange) {
    const existing = typeMap.get(deliverable.type) ?? {
      type: deliverable.type,
      total: 0,
      completed: 0,
    };
    existing.total += 1;
    if (COMPLETE_STATUSES.has(deliverable.status)) existing.completed += 1;
    typeMap.set(deliverable.type, existing);
  }

  const monthlyMap = new Map<string, number>();
  for (const document of documentsInRange) {
    const month = document.uploadedAt.slice(0, 7);
    if (!month) continue;
    monthlyMap.set(month, (monthlyMap.get(month) ?? 0) + 1);
  }

  const userAnalytics = [...userRows.values()]
    .filter(
      (row) =>
        !filters.user ||
        matchesTextFilter(row.email, filters.user) ||
        matchesTextFilter(row.name, filters.user)
    )
    .sort((a, b) => b.documentsSubmitted - a.documentsSubmitted || b.projectsInvolved - a.projectsInvolved);

  return {
    filters,
    stats: [
      { label: "Documents Submitted", value: documentsInRange.length },
      { label: "Projects Active in Range", value: programAnalytics.length },
      { label: "Deliverables Created", value: deliverablesInRange.filter((deliverable) => isWithinRange(getCreatedDate(deliverable), start, end)).length },
      { label: "Deliverables Completed", value: completedDeliverables.length },
      { label: "Pending Review", value: pendingReview.length },
      { label: "Overdue", value: overdue.length },
    ],
    userAnalytics,
    programAnalytics: programAnalytics.sort((a, b) => b.documentsSubmitted - a.documentsSubmitted),
    deliverableTypeAnalytics: [...typeMap.values()].sort((a, b) => b.total - a.total),
    monthlySubmissions: [...monthlyMap.entries()]
      .map(([month, documentsSubmitted]) => ({ month, documentsSubmitted }))
      .sort((a, b) => a.month.localeCompare(b.month)),
    programs: programs.map((program) => ({
      id: program.id,
      name: program.name,
      programNumber: program.programNumber,
    })),
    users: [...userRows.values()]
      .map(({ email, name }) => ({ email, name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    deliverableTypes: [...new Set(deliverables.map((deliverable) => deliverable.type))].sort(),
  };
}

export async function getProgramAnalytics(
  user: AnalyticsUser,
  programId: string,
  filters: AnalyticsFilters = {}
) {
  const overview = await getAnalyticsOverview(user, { ...filters, programId });
  const program = overview.programs.find((item) => item.id === programId);
  return {
    program,
    analytics: overview.programAnalytics.find((item) => item.id === programId),
    monthlySubmissions: overview.monthlySubmissions,
    deliverableTypeAnalytics: overview.deliverableTypeAnalytics,
  };
}

export async function getUserAnalytics(
  user: AnalyticsUser,
  userFilter: string,
  filters: AnalyticsFilters = {}
) {
  const overview = await getAnalyticsOverview(user, { ...filters, user: userFilter });
  return {
    user: overview.userAnalytics[0],
    programs: overview.programAnalytics,
    monthlySubmissions: overview.monthlySubmissions,
  };
}

export async function getDeliverablesAnalytics(
  user: AnalyticsUser,
  filters: AnalyticsFilters = {}
) {
  const overview = await getAnalyticsOverview(user, filters);
  return {
    stats: overview.stats,
    deliverableTypeAnalytics: overview.deliverableTypeAnalytics,
    programAnalytics: overview.programAnalytics,
  };
}
