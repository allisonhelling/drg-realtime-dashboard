import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canCreateProgram } from "@/lib/auth/guards";
import { listProgramOwnerPrincipals } from "@/lib/graph/users";

export async function GET(request: Request) {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  if (!canCreateProgram(session.user)) {
    return NextResponse.json(
      { error: "Only DRG admins can list program owners." },
      { status: 403 }
    );
  }

  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? "";

  try {
    const users = await listProgramOwnerPrincipals(query);
    return NextResponse.json({ users });
  } catch (error) {
    console.error("Failed to load Entra program owners", error);
    return NextResponse.json(
      {
        error:
          "Unable to load Entra program owners. Check Graph app permissions and ENTRA_DRG_PROGRAM_OWNER_GROUP_ID.",
      },
      { status: 502 }
    );
  }
}
