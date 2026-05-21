import { Suspense } from "react";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import CircularProgress from "@mui/material/CircularProgress";
import { listVisibleDeliverables } from "@/lib/dataverse/deliverables";
import SubmitReportWizard from "@/components/SubmitReportWizard";
import BackButton from "@/components/BackButton";
import { requireInternalRole } from "@/lib/auth/guards";

function getSafeReturnPath(returnTo?: string) {
  if (!returnTo || !returnTo.startsWith("/") || returnTo.startsWith("//")) {
    return undefined;
  }

  if (returnTo === "/submit" || returnTo.startsWith("/submit?")) {
    return undefined;
  }

  return returnTo;
}

function getBackConfig(input: { from?: string; returnTo?: string; returnLabel?: string }) {
  const safeReturnPath = getSafeReturnPath(input.returnTo);
  if (safeReturnPath) {
    return { href: safeReturnPath, label: input.returnLabel || "Back" };
  }

  if (input.from === "documents") {
    return { href: "/documents", label: "Documents" };
  }

  return { href: "/", label: "Dashboard" };
}

async function SubmitContent({
  initialProgramId,
  initialDeliverableId,
}: {
  initialProgramId?: string;
  initialDeliverableId?: string;
}) {
  const user = await requireInternalRole([
    "drg-admin",
    "drg-program-owner",
    "drg-staff",
  ]);
  const deliverables = await listVisibleDeliverables(user);

  return (
    <SubmitReportWizard
      deliverables={deliverables}
      initialProgramId={initialProgramId}
      initialDeliverableId={initialDeliverableId}
    />
  );
}

export default async function SubmitPage({
  searchParams,
}: {
  searchParams: Promise<{
    programId?: string;
    deliverableId?: string;
    from?: string;
    returnTo?: string;
    returnLabel?: string;
  }>;
}) {
  const { programId, deliverableId, from, returnTo, returnLabel } = await searchParams;
  const backConfig = getBackConfig({ from, returnTo, returnLabel });

  return (
    <Container maxWidth="md" sx={{ py: { xs: 3, sm: 4 } }}>
      <BackButton href={backConfig.href}>{backConfig.label}</BackButton>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h5">Submit Report</Typography>
        <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.25 }}>
          Upload a deliverable document to the permanent record
        </Typography>
      </Box>
      <Suspense
        fallback={
          <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
            <CircularProgress />
          </Box>
        }
      >
        <SubmitContent initialProgramId={programId} initialDeliverableId={deliverableId} />
      </Suspense>
    </Container>
  );
}
