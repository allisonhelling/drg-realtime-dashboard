"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Divider from "@mui/material/Divider";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import DashboardIcon from "@mui/icons-material/Dashboard";
import DescriptionIcon from "@mui/icons-material/Description";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import BusinessCenterIcon from "@mui/icons-material/BusinessCenter";
import Inventory2Icon from "@mui/icons-material/Inventory2";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import QueryStatsIcon from "@mui/icons-material/QueryStats";
import { useRole } from "@/lib/context/role-context";

const NAV_ITEMS = [
  { label: "Dashboard", href: "/", icon: DashboardIcon },
  { label: "Active Programs", href: "/programs", icon: BusinessCenterIcon },
  { label: "Archived Programs", href: "/programs/archived", icon: Inventory2Icon },
  null,
  { label: "Deliverables", href: "/records", icon: DescriptionIcon },
  { label: "Documents", href: "/documents", icon: FolderOpenIcon },
  { label: "Analytics", href: "/analytics", icon: QueryStatsIcon },
  { label: "Calendar", href: "/calendar", icon: CalendarMonthIcon },
];

export default function SidebarNav() {
  const pathname = usePathname();
  const { role, roles } = useRole();
  const canSubmit = role
    ? ["drg-admin", "drg-program-owner", "drg-staff"].includes(role)
    : false;
  const canViewAnalytics = roles.some((currentRole) =>
    ["drg-admin", "drg-program-owner", "drg-staff"].includes(currentRole)
  );

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <List sx={{ pt: 0, flex: 1 }}>
        {NAV_ITEMS.map((item, i) => {
          if (item === null) return <Divider key={`divider-${i}`} />;
          const { label, href, icon: Icon } = item;
          if (href === "/analytics" && !canViewAnalytics) return null;
          const active =
            href === "/"
              ? pathname === href
              : href === "/programs"
                ? pathname === "/programs"
                : pathname === href || pathname.startsWith(`${href}/`);
          return (
            <ListItemButton
              key={href}
              component={Link}
              href={href}
              selected={active}
              sx={{
                borderRadius: 0,
                "&.Mui-selected": {
                  bgcolor: "primary.main",
                  color: "#fff",
                  "&:hover": { bgcolor: "primary.main" },
                  "& .MuiListItemIcon-root": { color: "#fff" },
                },
              }}
            >
              <ListItemIcon sx={{ minWidth: 40 }}>
                <Icon fontSize="small" />
              </ListItemIcon>
              <ListItemText
                primary={label}
                primaryTypographyProps={{
                  fontSize: "0.875rem",
                  fontWeight: active ? 600 : 400,
                }}
              />
            </ListItemButton>
          );
        })}
      </List>

      {/* Submit Report CTA — role-gated */}
      {canSubmit && (
        <Box sx={{ p: 1.5, borderTop: "1px solid", borderColor: "divider" }}>
          <Button
            component={Link}
            href="/submit"
            variant="contained"
            startIcon={<UploadFileIcon />}
            fullWidth
            size="small"
            sx={{ fontWeight: 600 }}
          >
            Submit Report
          </Button>
        </Box>
      )}
    </Box>
  );
}
