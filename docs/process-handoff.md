# DRG IMS — Implementation & Handoff

> 📍 This document lays out the current state of the DRG IMS web application as of May 2026, including what we built, how it fits into DRG's Microsoft tenant, what IT needs to set up to run it in production, and where the implementation lands relative to the original SDD. It's meant to capture enough context that the project can be picked up later without us in the room.

## What we built

DRG IMS is a web application for managing CDRL/SDRL contract deliverables. Site managers submit signed PDFs through the app, program owners and external (government) reviewers retrieve them, and uploads plus external reviewer download/view activity are recorded as immutable entries in the audit log. The app is live for the duration of the capstone at https://drg-ims.vercel.app and it's designed to move over to a DRG-owned host without code changes.

The product exists because the current submission process runs on email, and email doesn't hold up well as evidence. A typical CDRL today goes from a site to the on-site government rep (CORE) to the NOC and then out to the customer, with each stop adding more people to the CC line and more copies of the same PDF flying around. When the customer later says they didn't receive something, there's no clean way to prove they did, so DRG ends up taking the grading hit. The IMS replaces that chain with one canonical document per deliverable and a per-document access log that any DRG admin can pull up and hand to the customer.

## How we got here

The original SDD, written by the PMO in February, scoped the IMS as a Microsoft Power Platform solution with PowerApps as the UI. After the Feb 18 stakeholder session, Scott and Jason landed on a different shape: a standalone web application that DRG could give external reviewers access to, plus a Microsoft Teams shortcut that opens the same app inside Teams for staff who want it there. We took that direction and kept everything else in the SDD intact.

So the implementation is Next.js for the application layer and the same Microsoft data, identity, and workflow services the SDD called for. Entra ID handles authentication, Dataverse stores structured records, SharePoint stores documents, and Power Automate handles notifications and approval flows. PowerApps is the only piece that got replaced. Everything underneath it is the same.

## Architecture

```
Browser
  |
  v
Next.js application layer
  |  Auth.js sign-in, server-side role guards, page rendering
  |
  +-->  Microsoft Entra ID       identity, role claims, reviewer group membership
  +-->  Microsoft Dataverse      programs, deliverables, audit log, approvals
  +-->  SharePoint via Graph     submitted PDFs, organized by program/deliverable
  +-->  Power Automate           submission, download, approval, access notifications
```

The Next.js layer handles routing, role-based access checks, and orchestration. Every request that touches a Microsoft service goes through the server, since the calls require credentials we can't ship to the browser. Authorization runs server-side too, so a user who hits a page they shouldn't see gets redirected before any data is fetched, not just hidden from the UI.

The four Microsoft services each own a clear slice. Entra ID is the identity provider and the source of truth for roles. Dataverse stores everything structured, including the audit log. SharePoint stores the actual PDF files since Dataverse is for records and metadata, not multi-megabyte binaries. Power Automate handles anything that needs to fan out into the rest of DRG's environment, like sending a Teams notification when a deliverable is submitted.

## Identity and access

### Authentication

The app uses Auth.js with the Microsoft Entra ID provider, so there's no second password and no application-managed credential store. DRG employees and external reviewers sign in through accounts that already exist in DRG's tenant. Auth.js handles the OIDC handshake, session storage, and CSRF protection, and our code reads the resulting claims to decide what the user can do.

### Role tiers

There are four internal roles plus one effective role:

- **drg-admin** is granted by membership in the `ENTRA_DRG_ADMIN_GROUP_ID` security group. Admins can do everything, including create and delete programs, manage accounts, and access every program regardless of who's assigned to it.
- **drg-program-owner** marks users who are eligible to be assigned as program owners. Granted by `ENTRA_DRG_PROGRAM_OWNER_GROUP_ID`.
- **drg-staff** sees only programs they've been added to and submits deliverables on those. Granted by `ENTRA_DRG_STAFF_GROUP_ID`.
- **external-reviewer** is the role for government and customer reviewers who have been added to DRG's tenant and assigned to the configured external reviewer group. They can view, download, and re-upload signed copies on programs they've been granted access to, but they can't delete anything. Granted by `ENTRA_EXTERNAL_REVIEWER_GROUP_ID`.
- **gov-reviewer** is an effective role applied at runtime to authenticated users whose email shows up in a program's access list but who don't hold any of the internal Entra roles above. It exists so one-off reviewers don't have to be added to a security group, just to the program access list.

Role-claim mapping lives in `src/lib/auth/roles.ts` and accepts both Entra app-role assignments and group claims, so DRG IT can grant roles either way. Common naming variants are accepted too, since the app role names DRG eventually settles on may not be the exact strings we put in the code.

Entra groups define broad eligibility and application identity, not the final program-specific permission by themselves. The actual program permission is the selected `drg_programaccess` role. A user in the program owner eligibility group can therefore be granted `DRG Staff` access on a specific program and will have staff-equivalent permissions there; owner-only actions still require an active `Program Owner` access row for that program.

### External reviewer onboarding

External reviewers must be pre-created in DRG's Entra tenant and assigned to the security group identified by `ENTRA_EXTERNAL_REVIEWER_GROUP_ID`. The app does not create tenant accounts. When an admin or assigned program owner grants program access, the app uses Microsoft Graph to verify that the selected user already exists and belongs to a group eligible for the requested program access role.

Revoking application-level access is handled by deactivating the `drg_programaccess` row. Removing the user from the Entra external reviewer group blocks future reviewer access more broadly.

### Audit logging

The app writes `drg_documentaccesslog` rows for all uploads and for external reviewer view/download activity before the file streams to the reviewer. Each entry captures who acted, what document was involved, the action type, the timestamp, and the program context. The app never deletes log entries during normal use, and a DRG admin can pull up the timeline for any document on the document detail page. This is the evidence chain for the dispute scenario, where a customer claims they didn't receive a CDRL and DRG needs to show otherwise.

## Data and documents

### Dataverse tables

Everything structured lives in Dataverse:

- `drg_program` for program records
- `drg_programsite` for the sites belonging to a program
- `drg_programaccess` for explicit access grants per (program, user)
- `drg_deliverable` for individual CDRL/SDRL items
- `drg_deliverabletype` for the deliverable type catalog
- `drg_document` for submitted document records, including the SharePoint pointer
- `drg_documentaccesslog` for the immutable access log
- `drg_approval` for approval decisions

The TypeScript types in `src/lib/dataverse/` are the closest thing to a schema spec the project has, since they're what the app reads and writes against. Each module in that folder maps to one entity area and uses the column names DRG IT can mirror when defining the matching Dataverse tables.

### SharePoint document library

PDFs live in a SharePoint document library that the app accesses through the Microsoft Graph drive API. The default folder layout is `{SHAREPOINT_DOCUMENT_FOLDER}/{programId}/{deliverableId}/`, but that's configurable through `SHAREPOINT_FOLDER_STRATEGY` if a flat structure is preferred. The app rejects non-PDF uploads at the application layer before the upload is attempted, so the library should only ever contain PDFs.

## Workflows and notifications

Most workflow automation is Dataverse-triggered. The app creates or updates the appropriate `drg_*` rows, then Power Automate flows handle status rollups, superseding, field stamping, and notifications. The only app-called HTTP flow is `DRG Acknowledges Signed Approval`, whose URL is supplied through `POWER_AUTOMATE_APPROVAL_ACKNOWLEDGED_URL`.

| Flow area | Fires when |
|---|---|
| Submission created | A `DRG Submission` document row is created |
| Ready for review | A DRG user marks a submitted/returned deliverable `In Review` from the app |
| Access events | A document access log row is created |
| Reviewer response / signed approval | A child document row is created with `Reviewer Response` or `Signed Approval` role |
| Approval decision | A current approval row changes to Approved or Rejected |
| Acknowledgment | A DRG user explicitly acknowledges a signed approval from the app |
| Program/access maintenance | Program, program access, and deliverable type rows are created or updated |

The imported solution separates upload from external review notification. Uploading a DRG submission creates/supersedes document metadata and creates current approval rows. The explicit **Ready for Review** app action moves the deliverable to `In Review`, and the `Deliverable Ready for Review` flow notifies active external reviewers. Dataverse-triggered flows should link to app URLs, not direct SharePoint file URLs.

## What DRG IT needs to set up

To run the app in DRG's tenant, the following needs to exist. Items in **bold** require a tenant administrator.

### Entra ID

- An **app registration** for the web app with redirect URI `https://<host>/api/auth/callback/microsoft-entra-id`, a client secret or certificate, and the delegated scopes `openid`, `profile`, `email`, and `User.Read`. App role assignments or group claims need to be included in the ID/access token so the app sees them.
- An **app registration** for Microsoft Graph user and group lookup with the application permissions needed to read users and group membership, with admin consent granted.
- An **app registration** for Dataverse, set up as a Dataverse Application User with create, read, update, and append on the `drg_*` tables. Delete should stay restricted to elevated admins, since the app's own role checks already gate deletion to admin-only.
- An **app registration** for SharePoint via Graph with `Sites.Selected` (preferred) or `Files.ReadWrite.All`, admin consent granted. If `Sites.Selected` is used, the chosen site needs to be granted access to the registration explicitly through PowerShell or a Graph call.
- Four **security groups** populated with the right people: DRG Admin, DRG Program Owner Eligibility, DRG Staff, and External Reviewer. The IDs of these groups go into the env config.

### Dataverse

A Dataverse environment in the Power Platform admin center, with the `drg_*` tables defined per the schema in `src/lib/dataverse/`. The Dataverse app registration needs to be set up as an Application User with a security role that grants it the right CRUD permissions on those tables.

### SharePoint

A document library on whichever SharePoint site DRG wants to use for IMS storage, with the site ID and drive ID recorded for the env config. The default library name in `.env.example` is "DRG Submissions" but it's configurable.

### Power Automate

Import the supplied Power Automate solution package. Most flows are Dataverse-triggered or scheduled. The app directly calls only the `DRG Acknowledges Signed Approval` instant flow, whose trigger URL goes into `POWER_AUTOMATE_APPROVAL_ACKNOWLEDGED_URL`.

### Hosting

Today the app runs on Vercel for iteration speed. The intended production host is Azure App Service, since that consolidates the deployment with the rest of DRG's Microsoft 365 footprint. Migration is a config exercise, not a code change: provision the App Service plan, push the Next.js build, set the env vars, and point DNS at it. Either way, the host needs HTTPS and a public URL that matches `AUTH_URL` and `APP_URL`.

## Environment variables

The full inventory lives in `.env.example`. All variables are read on the server and never reach the browser bundle. If a service's variables are blank, the app falls back to mock or no-op behavior so local development and partial-rollout staging environments keep working.

**Auth.js and Entra ID**

```
AUTH_SECRET
AUTH_URL
AUTH_MICROSOFT_ENTRA_ID_ID
AUTH_MICROSOFT_ENTRA_ID_SECRET
AUTH_MICROSOFT_ENTRA_ID_ISSUER
ENTRA_DRG_ADMIN_GROUP_ID
ENTRA_DRG_PROGRAM_OWNER_GROUP_ID
ENTRA_DRG_STAFF_GROUP_ID
ENTRA_EXTERNAL_REVIEWER_GROUP_ID
```

`AUTH_SECRET` is any 32+ character random string and `AUTH_URL` is the public app URL. The Entra ID issuer is `https://login.microsoftonline.com/<tenant-id>/v2.0`. The four `ENTRA_*_GROUP_ID` values are the object IDs of the security groups described above.

**Dataverse**

```
DATAVERSE_ENVIRONMENT_URL
DATAVERSE_TENANT_ID
DATAVERSE_CLIENT_ID
DATAVERSE_CLIENT_SECRET
DATAVERSE_CLIENT_CERTIFICATE_PRIVATE_KEY
DATAVERSE_CLIENT_CERTIFICATE_THUMBPRINT
DATAVERSE_SCOPE
```

Dataverse can authenticate with either a client secret or a certificate, so populate one or the other. `DATAVERSE_SCOPE` is usually `<environment-url>/.default`.

**SharePoint via Microsoft Graph**

```
SHAREPOINT_TENANT_ID
SHAREPOINT_CLIENT_ID
SHAREPOINT_CLIENT_SECRET
SHAREPOINT_SITE_ID
SHAREPOINT_DRIVE_ID
SHAREPOINT_DOCUMENT_FOLDER
SHAREPOINT_FOLDER_STRATEGY
```

`SHAREPOINT_FOLDER_STRATEGY` is either `program-deliverable` (the default) or `flat`.

**Power Automate**

```
POWER_AUTOMATE_APPROVAL_ACKNOWLEDGED_URL
```

**Microsoft Graph for user/group lookup**

```
AZURE_TENANT_ID
AZURE_GRAPH_CLIENT_ID
AZURE_GRAPH_CLIENT_SECRET
```

**Application links**

```
APP_URL
```

`APP_URL` is the public URL used in app-generated links and usually matches `AUTH_URL`.

## Deployment and distribution

### Today

The app is on Vercel at https://drg-ims.vercel.app. The build is a stock Next.js App Router production build with no Vercel-specific dependencies, which means the same code runs unchanged on any host that supports Node.js.

### Production migration

When DRG is ready to consolidate hosting, the path is Azure App Service. Provision an App Service plan in DRG's tenant, deploy the Next.js build, set the environment variables, and update DNS. There's no code change involved. The legacy Azure GitHub Actions workflow at `.github/workflows/franco-teams-update-feed-prototype_drg-ims.yml` is left in the repo for reference, but it isn't the deploy path of record since we ran into App Service standalone-build issues during the prototype phase that ate more time than they were worth.

### Microsoft Teams app

A sideloadable Teams app package lives in `teams-app/`. It registers DRG IMS as both a personal app and a configurable channel tab, so a DRG team can drop the IMS into a channel and pin it to whichever view makes sense for that program. The host URL is baked in at build time:

```
cd teams-app
./build.sh drg-ims.drg.com
```

That produces `teams-app/drg-ims-teams.zip`, which gets uploaded through the Teams admin center for org-wide installation or sideloaded by individuals. The `frame-ancestors` Content-Security-Policy headers in `next.config.ts` allow embedding from `teams.microsoft.com`, `*.office.com`, `*.sharepoint.com`, and `*.cloud.microsoft`, so the same app renders cleanly inside a Teams tab.

## Testing

The repo has a multi-language test suite, run via `pnpm test:all`. TypeScript tests cover role-claim mapping, route access guards, the notification payload format, and a 439-line production integration suite that checks Dataverse choice and lookup mapping, program visibility by role, document upload validation, archived-program upload blocking, approval business rules, audit log payloads, and Power Automate acknowledgement payloads. Python and Java suites both reimplement the Teams notification payload builder to satisfy the cross-language testing requirement and verify the contract holds across runtimes. Linting runs through ESLint with the Next.js core-web-vitals and TypeScript rules.

## Implementation vs production

| Area | Status |
|---|---|
| Authentication via Entra ID | Production-ready, real Auth.js + Entra provider |
| Role mapping (4 internal + gov-reviewer) | Production-ready, Entra app roles and group claims supported |
| Dataverse data model and CRUD | Production-ready, real Web API client with secret or certificate auth |
| SharePoint upload and download | Production-ready, real Microsoft Graph integration |
| Power Automate triggers (app side) | Production-ready, flows must be authored on the DRG side |
| External reviewer prerequisite | Production-ready, reviewers must already exist in Entra and belong to the configured external reviewer group |
| Immutable audit log | Production-ready, uploads and external reviewer download/view activity are written to `drg_documentaccesslog` |
| Mock connectors | Retained as fallback for unconfigured environments, safe to leave as-is once env is fully populated |
| Multi-factor authentication | Inherited from DRG's Entra conditional access policies, not enforced inside the app |
| Branding | Default DRG logos and a navy theme, further refinement is at DRG's discretion |

## Glossary

- **Auth.js** is the open-source authentication library for Next.js, formerly NextAuth. The app uses it with the Microsoft Entra ID provider.
- **CDRL / SDRL** are Contract Data Requirements List and Subcontract Data Requirements List, the two deliverable categories the IMS exists to manage.
- **Entra ID** is Microsoft's identity service, formerly Azure Active Directory.
- **MUI** is Material UI, the React component library used for the app's interface.
- **Next.js App Router** is the file-based routing and Server Component framework for the application layer.
- **PMO** is the Program Management Office, who authored the original SDD.
- **RBAC** is Role-Based Access Control.
- **SDD** is the System Design Document the PMO published on 2026-02-16. This document is its companion.

---

Authored by Group F (OU CS4273 Capstone, Spring 2026): Franco Barbaro, Allison Helling, Charlie Street, Joshua Kam, Ruby Morales.
