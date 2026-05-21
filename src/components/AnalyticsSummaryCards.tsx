import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";

export interface AnalyticsSummaryCard {
  label: string;
  value: number | string;
  alert?: boolean;
}

export default function AnalyticsSummaryCards({
  cards,
}: {
  cards: AnalyticsSummaryCard[];
}) {
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: {
          xs: "repeat(2, minmax(0, 1fr))",
          md: `repeat(${Math.min(cards.length, 4)}, minmax(0, 1fr))`,
        },
        gap: 1.5,
      }}
    >
      {cards.map((card) => (
        <Card
          key={card.label}
          variant="outlined"
          sx={card.alert ? { borderColor: "error.main" } : undefined}
        >
          <CardContent sx={{ p: 1.5, "&:last-child": { pb: 1.5 } }}>
            <Typography
              sx={{
                fontWeight: 700,
                fontSize: "1.35rem",
                lineHeight: 1.25,
                color: card.alert ? "error.main" : "primary.main",
              }}
            >
              {card.value}
            </Typography>
            <Typography
              variant="caption"
              sx={{ color: "text.secondary", fontWeight: 700 }}
            >
              {card.label}
            </Typography>
          </CardContent>
        </Card>
      ))}
    </Box>
  );
}
