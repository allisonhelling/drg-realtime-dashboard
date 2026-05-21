import type { Metadata } from "next";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v16-appRouter";
import { ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import theme from "@/lib/theme";
import AuthProvider from "@/components/AuthProvider";
import AppShell from "@/components/AppShell";
import { RoleProvider } from "@/lib/context/role-context";
import "./globals.css";

export const metadata: Metadata = {
  title: "Delaware Resource Group — Information Management System",
  description: "CDRL/SDRL deliverable tracking and cross-department visibility",
};

// Provider stack: MUI cache, theme, CSS reset, then role context.
// RoleProvider wraps everything so any component can read/switch the active role.
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        style={{ display: "flex", flexDirection: "column", height: "100vh" }}
      >
        <AppRouterCacheProvider>
          <ThemeProvider theme={theme}>
            <CssBaseline />
            <AuthProvider>
              <RoleProvider>
                <AppShell>{children}</AppShell>
              </RoleProvider>
            </AuthProvider>
          </ThemeProvider>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}
