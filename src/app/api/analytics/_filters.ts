import type { AnalyticsFilters } from "@/lib/analytics";
import { DOCUMENT_ROLES } from "@/lib/models/document";

export function analyticsFiltersFromRequest(request: Request): AnalyticsFilters {
  const params = new URL(request.url).searchParams;
  const documentRole = params.get("documentRole") ?? undefined;

  return {
    startDate: params.get("startDate") ?? undefined,
    endDate: params.get("endDate") ?? undefined,
    programId: params.get("programId") ?? undefined,
    user: params.get("user") ?? undefined,
    deliverableType: params.get("deliverableType") ?? undefined,
    status: params.get("status") ?? undefined,
    documentRole: DOCUMENT_ROLES.includes(documentRole as never)
      ? (documentRole as AnalyticsFilters["documentRole"])
      : undefined,
  };
}
