import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { hasAnyRole } from "@/lib/auth/roles";
import { searchProgramCollaboratorPrincipals } from "@/lib/graph/users";

export async function GET(request: Request) {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  if (
    !hasAnyRole(session.user.internalRoles, [
      "drg-admin",
      "drg-program-owner",
      "drg-staff",
    ])
  ) {
    return NextResponse.json(
      { error: "Only DRG admins, program owners, or DRG staff can search collaborators." },
      { status: 403 }
    );
  }

  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? "";

  try {
    const users = await searchProgramCollaboratorPrincipals(query);
    return NextResponse.json({ users });
  } catch (error) {
    console.error("Failed to load Entra collaborators", error);
    return NextResponse.json(
      {
        error:
          "Unable to load Entra collaborators. Check Graph permissions and Entra group IDs.",
      },
      { status: 502 }
    );
  }
}
