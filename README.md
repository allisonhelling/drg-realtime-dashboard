# DRG IMS
CS4273 Capstone, Spring 2026 | Group F
Franco Barbaro, Allison Helling, Charlie Street, Joshua Kam, Ruby Morales

https://drg-ims.vercel.app

## About

Our client is DRG, a defense contractor. They handle monthly deliverable submissions across 26 sites and all of it runs through email right now, 40+ people CC'd every time a document goes out. When the government says they never got something, there's no clean proof trail. We built a document portal where submissions are permanent, uploads and external reviewer download/view activity are logged, and each role only sees what they're supposed to.

## Who did what

Franco developed the application's UI. Allison handled deployment, integration with the backend, and test files. Joshua put together the project documentation. Charlie and Ruby contributed to the notification module and domain model documentation.

## Setup

Requires Node.js 22 and pnpm 10. Python 3.8+ and Java 17+/Maven are only needed for those test suites.

```bash
git clone https://github.com/Almi263/drg-realtime-dashboard.git
cd drg-realtime-dashboard
pnpm install
pnpm dev
# http://localhost:3000
```

To connect Microsoft Entra ID and the production Microsoft integrations, copy `.env.example` to `.env.local` and fill in:

- `AUTH_SECRET` and `AUTH_URL`
- `AUTH_MICROSOFT_ENTRA_ID_ID`, `AUTH_MICROSOFT_ENTRA_ID_SECRET`, and `AUTH_MICROSOFT_ENTRA_ID_ISSUER`
- `ENTRA_DRG_ADMIN_GROUP_ID`, `ENTRA_DRG_PROGRAM_OWNER_GROUP_ID`, `ENTRA_DRG_STAFF_GROUP_ID`, and `ENTRA_EXTERNAL_REVIEWER_GROUP_ID`
- `DATAVERSE_ENVIRONMENT_URL`, `DATAVERSE_TENANT_ID`, `DATAVERSE_CLIENT_ID`, and either `DATAVERSE_CLIENT_SECRET` or the Dataverse certificate credential variables
- `SHAREPOINT_TENANT_ID`, `SHAREPOINT_CLIENT_ID`, `SHAREPOINT_CLIENT_SECRET`, `SHAREPOINT_SITE_ID`, `SHAREPOINT_SITE_URL`, and `SHAREPOINT_DRIVE_ID`
- `POWER_AUTOMATE_APPROVAL_ACKNOWLEDGED_URL` for the one app-called instant flow; the rest of the solution flows are Dataverse-triggered
- `AZURE_TENANT_ID`, `AZURE_GRAPH_CLIENT_ID`, and `AZURE_GRAPH_CLIENT_SECRET` for Microsoft Graph user/group lookup

When Microsoft credentials are configured, server-side services in `src/lib/dataverse/`, `src/lib/sharepoint/`, and `src/lib/graph/` use Dataverse, SharePoint, and Graph. If Dataverse is not configured, the app falls back to mock fixtures for local development and demos.

## Source layout

```
src/
  app/              Next.js App Router pages
    programs/       program list and detail
    records/        deliverable list and detail
    documents/      document repository and detail
    submit/         4-step submission wizard (role-gated)
    calendar/       deadline tracker
  components/       shared UI (tables, cards, wizard, role guard)
  lib/
    models/         TypeScript types (Program, Deliverable, Document, UpdateEvent)
    connectors/     mock data adapters
    notifications/  Teams notification payload builder
    context/        role context provider
    theme.ts        MUI theme
```

## Routes

- `/` is the dashboard with program status cards and stats
- `/programs` and `/programs/[id]` for program-level views
- `/records` and `/records/[id]` for deliverables
- `/documents` and `/documents/[id]` for the document repository, each document has an expandable access log
- `/submit` is the submission wizard, only accessible to drg-staff, drg-program-owners, and drg-admin roles
- `/calendar` groups upcoming deadlines by urgency

## How it's built

Production data access runs through server-only services in `src/lib/dataverse/`, `src/lib/sharepoint/`, `src/lib/graph/`, and `src/lib/power-automate/`. Mock connectors remain only as fallback fixtures when Microsoft service credentials are not configured.

Authentication uses Auth.js with the Microsoft Entra ID provider. Internal roles come from Entra app roles or group claims, while `gov-reviewer` is derived from a matching email in a program's access list. External reviewers must already exist in the tenant and belong to the configured external reviewer group before program access can be granted.

## Tests

```bash
pnpm test:all    # TypeScript + Python + Java
pnpm test        # TypeScript only (Vitest)
```

We implemented the Teams notification payload builder in TypeScript, Python, and Java to satisfy the multi-language testing requirement. `pnpm test` runs just the TypeScript suite if you don't have Java set up.

## Deployment

Live at https://drg-ims.vercel.app, hosted on Vercel for prototype iteration speed. Production target is Azure App Service alongside the rest of the client's Microsoft stack; the Vercel host is reachable from Teams and Office iframes via the CSP `frame-ancestors` headers configured in `next.config.ts`.

```bash
vercel --prod    # from the project root, after `vercel link`
```

Production deployment checklist:

- Set `AUTH_URL` and `APP_URL` to the final public app origin, for example `https://drg-ims.vercel.app` or the Azure App Service custom domain. These URLs are used by Auth.js redirects and notification links.
- In the Microsoft Entra app registration for sign-in, add redirect URI `<APP_URL>/api/auth/callback/microsoft-entra-id`. Keep `AUTH_MICROSOFT_ENTRA_ID_ISSUER` on the same tenant as the app registration.
- Configure Entra app roles or group claims for the four app roles: DRG admin, program owner, DRG staff, and external reviewer. Store the group object IDs in the matching `ENTRA_*_GROUP_ID` variables.
- Configure the Dataverse server-to-server app registration with permission to read/write the target environment tables. Set `DATAVERSE_ENVIRONMENT_URL` to the environment URL and use either client secret or certificate credentials.
- Configure the SharePoint app registration/client credential with Microsoft Graph access to the target site and document library. Set `SHAREPOINT_SITE_ID`, `SHAREPOINT_SITE_URL`, and `SHAREPOINT_DRIVE_ID` for the final library.
- Import the Power Automate solution package. Most flows are Dataverse-triggered; configure only the app-called acknowledgment flow URL in `POWER_AUTOMATE_APPROVAL_ACKNOWLEDGED_URL`. The flow responsibilities are documented in `docs/power-automate-cloud-flows.md`.
- Configure Microsoft Graph application permissions for user and group lookup. External reviewers must be pre-created in the tenant and assigned to `ENTRA_EXTERNAL_REVIEWER_GROUP_ID` before the app can grant program access.
- Rebuild the Teams package with the final host and upload the new zip to Teams admin center: `cd teams-app && ./build.sh <deployed-host>`.

The legacy Azure GitHub Actions workflow in `.github/workflows/franco-teams-update-feed-prototype_drg-ims.yml` is retained for reference but is not the deploy path of record.

## Microsoft Teams app

A sideloadable Teams app package lives in `teams-app/`. It registers the dashboard as both a personal app and a configurable channel tab so users can drop "DRG IMS" directly into a team's channel and pick which view (Dashboard, Records, Calendar, Documents, Submit) the tab opens to.

```bash
cd teams-app
./build.sh drg-ims.vercel.app    # rebuild whenever the host changes
```

That produces `teams-app/drg-ims-teams.zip`, ready to upload via Teams admin center or sideload. See `teams-app/README.md` for install steps.

## Linting

```bash
pnpm lint
```
