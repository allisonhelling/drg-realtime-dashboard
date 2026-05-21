import { Suspense } from "react";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Container from "@mui/material/Container";
import AnalyticsPageView from "@/components/AnalyticsPageView";
import { requireUser } from "@/lib/auth/guards";
import { getAnalyticsOverview } from "@/lib/analytics";

async function AnalyticsContent() {
  const user = await requireUser();
  const overview = await getAnalyticsOverview(user, {
    startDate: "2026-01-01",
    endDate: "2026-12-31",
  });

  return <AnalyticsPageView initialOverview={overview} />;
}

export default function AnalyticsPage() {
  return (
    <Container maxWidth="xl" sx={{ py: { xs: 3, sm: 4 } }}>
      <Suspense
        fallback={
          <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
            <CircularProgress />
          </Box>
        }
      >
        <AnalyticsContent />
      </Suspense>
    </Container>
  );
}
