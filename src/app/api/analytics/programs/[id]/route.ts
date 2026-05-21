import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { analyticsFiltersFromRequest } from "@/app/api/analytics/_filters";
import { getProgramAnalytics } from "@/lib/analytics";
import { errorResponse } from "@/lib/errors/business-rules";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  try {
    const { id } = await params;
    const analytics = await getProgramAnalytics(
      session.user,
      id,
      analyticsFiltersFromRequest(request)
    );
    return NextResponse.json(analytics);
  } catch (error) {
    return errorResponse(error, { fallback: "Failed to load program analytics." });
  }
}
