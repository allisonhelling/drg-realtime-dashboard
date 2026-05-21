import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { analyticsFiltersFromRequest } from "@/app/api/analytics/_filters";
import { getDeliverablesAnalytics } from "@/lib/analytics";
import { canViewAnalytics } from "@/lib/auth/guards";
import { errorResponse } from "@/lib/errors/business-rules";

export async function GET(request: Request) {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  if (!canViewAnalytics(session.user)) {
    return NextResponse.json({ error: "Analytics access is restricted." }, { status: 403 });
  }

  try {
    const analytics = await getDeliverablesAnalytics(
      session.user,
      analyticsFiltersFromRequest(request)
    );
    return NextResponse.json(analytics);
  } catch (error) {
    return errorResponse(error, { fallback: "Failed to load deliverable analytics." });
  }
}
