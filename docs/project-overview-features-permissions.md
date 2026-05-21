# DRG IMS Project Overview, Features, and Permissions

## 1. Project Overview

DRG IMS is a document lifecycle and deliverable tracking portal for Defense Resource Group's CDRL and SDRL submission process. The application replaces an email-heavy workflow with a centralized system where programs, deliverables, uploaded PDFs, reviewer decisions, signed approvals, and document access history are tracked in one place.

The current repository implements the web application layer in Next.js and integrates with the Microsoft ecosystem expected by the client:

- Microsoft Entra ID for authentication and role claims.
- Microsoft Dataverse for structured program, deliverable, approval, document metadata, access, and audit records.
- SharePoint document libraries for file storage.
- Microsoft Graph for SharePoint file access, Entra group membership lookup, and tenant user lookup workflows.
- Power Automate for workflow automation, status transitions, notifications, and archival side effects.
- Microsoft Teams packaging so the dashboard can run as a Teams personal app or configurable channel tab.

The project is designed as a production-shaped prototype. When Microsoft service credentials are configured, the app uses Dataverse and SharePoint. When those credentials are not configured, the connector layer can fall back to local mock data so the UI and tests remain usable in development.

## 2. Technology Stack

| Area | Implementation |
| --- | --- |
| Web framework | Next.js App Router |
| Language | TypeScript |
| UI | React, Material UI, DRG-branded theme assets |
| Authentication | Auth.js / NextAuth v5 with Microsoft Entra ID |
| Structured data | Microsoft Dataverse Web API |
| File storage | SharePoint document library through Microsoft Graph |
| Workflow automation | Power Automate cloud flows |
| Collaboration surface | Microsoft Teams app package |
| Testing | Vitest TypeScript tests, plus Python and Java tests for Teams payload parity |
| Deployment target | Vercel for prototype hosting; Azure App Service is the intended Microsoft-stack production target |

## 3. Primary User Goals

The system supports four core goals:

1. Give DRG staff and program owners a permanent, searchable record of CDRL/SDRL deliverables and submissions.
2. Give external reviewers scoped access to only the programs and documents they are assigned to review.
3. Preserve proof of document delivery by forcing downloads through the application and writing access logs for uploads plus external reviewer view/download activity.
4. Reduce email-based coordination by using dashboard views, status tracking, Teams notifications, and Power Automate workflows.

## 4. Main Application Areas

| Route | Purpose |
| --- | --- |
| `/` | Dashboard showing active program, deliverable, document, and approval status. |
| `/programs` | Active program list. |
| `/programs/archived` | Archived program list. |
| `/programs/[id]` | Program detail view with deliverables, documents, status, and program-level actions. |
| `/programs/[id]/access` | Program access management for admins and authorized program owners. |
| `/records` | Deliverable list and filtering view. |
| `/records/[id]` | Deliverable detail page with related documents and approvals. |
| `/documents` | Document repository view. |
| `/documents/[id]` | Document detail view, including access history. |
| `/submit` | Submission wizard for users who can upload to at least one program. |
| `/calendar` | Deadline-focused view for upcoming deliverables and reviews. |
| `/teams/configure` | Teams tab configuration page. |
| `/signin` | Entra ID sign-in entry point. |
| `/unauthorized` | Access-denied page. |

## 5. Feature Summary

### 5.1 Authentication and Role-Aware UI

Users sign in with Microsoft Entra ID through Auth.js. The application maps Entra app role claims and configured Entra group IDs into internal roles:

- `drg-admin`
- `drg-program-owner`
- `drg-staff`
- `external-reviewer`

The frontend role context also derives `gov-reviewer` when the signed-in user has an active program access row. This is an effective UI role used for program-scoped visibility; it is not a direct Entra role.

The navigation, buttons, submit wizard, detail pages, and management pages all use these roles plus program access data to decide what a user can see or do.

### 5.2 Dashboard

The dashboard summarizes visible deliverables, documents, and approvals for the signed-in user. Admins see all active programs. Non-admin users see only programs where they have active `drg_programaccess`.

The dashboard focuses on:

- CDRL/SDRL status.
- Active program health.
- Current documents.
- Pending and completed approval states.
- Deadline and overdue awareness.

### 5.3 Program Management

Programs represent contracts or project areas. Program records include:

- Name and program number.
- Contract reference.
- Description.
- Sites.
- Start and end dates.
- Program owner.
- Status: Draft, Active, On Hold, Closed, or Archived.
- Explicit access list.

Only DRG admins can create or delete programs. Program owners can manage access only for programs where they have active Program Owner access. Archived programs remain readable to authorized users but block uploads and workflow actions.

### 5.4 Program Access Management

Program access is stored as application data, not as direct Dataverse table access for ordinary users. Each access row connects a user email to a program and access role:

- Program Owner
- DRG Staff
- External Reviewer
- Read Only

Admins can manage access for any program. Program owners can manage access for programs where they are assigned as an active Program Owner. Users cannot revoke their own access through the client-side access controls.

The app can search configured Entra groups for eligible program owners, staff, and external reviewers through Microsoft Graph. External reviewers must already exist in DRG's tenant and belong to the configured external reviewer group before program access can be granted. The app verifies this prerequisite; it does not create tenant users.

### 5.5 Deliverable Management

Deliverables represent contractual submission obligations under a program. They include:

- Title.
- Deliverable number.
- CDRL/SDRL or custom deliverable type.
- Due date.
- Assigned user/email.
- Status.
- Program and contract reference.
- Current submission number.
- Completion and acknowledgment fields.

Supported statuses are:

- Draft
- Not Submitted
- Submitted
- In Review
- Returned
- Pending Acknowledgment
- Complete
- Overdue - Waiting on Reviewer
- Overdue - Waiting on DRG

Admins and program owners can create approved deliverables. DRG staff can create deliverable drafts for assigned programs; those drafts require approval by an admin or assigned program owner before becoming active.

Deliverables can be deleted by admins. Program owners can delete a deliverable only when they own the program, the program is not archived, and the deliverable has no linked documents.

### 5.6 Document Submission and Repository

The app supports PDF-centered document submission and review workflows. Document metadata is stored in Dataverse, while the file binary is stored in SharePoint.

Document roles are:

- DRG Submission
- Reviewer Response
- Signed Approval

Document statuses are:

- Submitted
- Under Review
- Returned
- Viewed
- Outdated
- Overdue - Waiting on Reviewer
- Reviewed
- Final
- Archived

The submit workflow uploads a PDF to SharePoint, creates a Dataverse document metadata row, and lets Power Automate perform downstream workflow actions such as assigning submission numbers, superseding old current submissions, creating approvals, and notifying reviewers.

User downloads do not redirect to raw SharePoint URLs. Downloads go through the app's API so the app can:

- Verify the user's role and active program access.
- Write a document access log for external reviewer downloads.
- Fetch the file from SharePoint using app credentials.
- Stream the file back to the user.

Uploads are always written to `drg_documentaccesslog`. Download/view logs are intentionally focused on external reviewer activity, which is the audit evidence DRG needs for customer receipt disputes.

### 5.7 Approval and Acknowledgment Workflow

Approvals track reviewer decisions for a deliverable submission. Approval records include:

- Program.
- Deliverable.
- Document.
- Submission number.
- Reviewer email.
- Decision: Pending, Approved, or Rejected.
- Comments.
- Optional response document.
- Due date.
- Decision date.
- Current/historical flag.

External reviewers can submit approval decisions only when:

- They have the `external-reviewer` internal role.
- They have active External Reviewer access for the program.
- The approval is current.
- The approval reviewer email matches their signed-in email.
- The program is not archived.

When a signed approval PDF is available, DRG staff or other authorized internal users can acknowledge it. The acknowledgment action calls the configured Power Automate flow so the deliverable can be completed and the accepted document can be marked final.

### 5.8 Calendar and Deadline Tracking

The calendar page groups visible deliverables and review deadlines by urgency. It helps users identify due, overdue, and upcoming work without manually scanning every program.

### 5.9 Teams Integration

The `teams-app/` package registers DRG IMS as:

- A Teams personal app.
- A configurable Teams channel tab.

The channel tab can be configured to open specific views such as Dashboard, Records, Calendar, Documents, or Submit. The Next.js CSP configuration allows the app to be embedded by Microsoft Teams, Office, and SharePoint iframe hosts.

### 5.10 Notifications

Teams notification payload builders live in `src/lib/notifications/`. The repository includes TypeScript, Python, and Java tests for notification payload parity. Power Automate is expected to send workflow notifications when events occur, such as submissions, reviewer actions, overdue work, and acknowledgment transitions.

## 6. Permission Model

The permission model has three layers:

1. Entra role or group membership gives the user broad application identity.
2. `drg_programaccess` gives the user program-specific access.
3. Server-side route/API guards enforce the final decision for reads, writes, uploads, downloads, approvals, and access management.

Direct Dataverse access is intentionally restricted. Normal program owners, staff, and external reviewers use the web app only. Direct Dataverse roles are reserved for DRG IT/admin users and the web app service principal.

### 6.1 Application Roles

| Role | Meaning |
| --- | --- |
| DRG Admin | Full application administrator. Can create programs, manage any access list, see all active/archived programs, archive/delete where implemented, and work across programs. |
| DRG Program Owner | Program manager role. Can view and manage assigned programs when an active Program Owner access row exists. |
| DRG Staff | Internal contributor role. Can work assigned programs, create staff deliverable drafts, and upload submissions when assigned. |
| External Reviewer | External/customer reviewer role. Can review and upload reviewer documents for assigned programs only. |
| Gov Reviewer | Derived effective role for users with active program access; used by UI logic to represent scoped reviewer visibility. |

### 6.2 Program Access Roles

| Program access role | Typical use |
| --- | --- |
| Program Owner | Allows an internal program owner to manage the program and its access list. |
| DRG Staff | Allows internal staff to work on assigned program deliverables and submissions. |
| External Reviewer | Allows reviewer participation for assigned program documents and approvals. |
| Read Only | Reserved for view-only access patterns. |

### 6.3 Permission Matrix

| Action | DRG Admin | Program Owner | DRG Staff | External Reviewer | Read-only/program-scoped user |
| --- | --- | --- | --- | --- | --- |
| Sign in | Yes, through Entra ID | Yes, through Entra ID | Yes, through Entra ID | Yes, through Entra ID | Yes, through Entra ID |
| View all active programs | Yes | No | No | No | No |
| View assigned program | Yes | Yes, with active Program Owner access | Yes, with active DRG Staff or Program Owner access | Yes, with active External Reviewer access | Yes, with active access |
| View archived assigned program | Yes | Yes, if assigned | Yes, if assigned | Yes, if assigned | Yes, if assigned |
| Create program | Yes | No | No | No | No |
| Update program details | Yes; assigned owners may update where access management permits | Yes, for owned programs | No | No | No |
| Delete program | Yes | No | No | No | No |
| Manage program access | Yes, any program | Yes, owned programs only | No | No | No |
| Grant program access | Yes | Yes, owned programs only | No | No | No |
| Revoke program access | Yes | Yes, owned programs only, not self | No | No | No |
| Create approved deliverable | Yes | Yes, owned programs only | No | No | No |
| Create deliverable draft | Yes | Yes, owned programs only | Yes, assigned programs only | No | No |
| Approve deliverable draft | Yes | Yes, owned programs only | No | No | No |
| Delete deliverable | Yes | Yes, owned programs only and only when no documents exist | No | No | No |
| Upload document | Yes | Yes, owned programs only | Yes, assigned programs only | Yes, assigned programs only for reviewer-side uploads | No |
| Download document | Yes | Yes, assigned programs | Yes, assigned programs | Yes, assigned programs | Yes, assigned programs |
| Submit approval decision | No, unless acting through reviewer-specific workflow not currently modeled | No | No | Yes, only for their current assigned approval | No |
| Acknowledge signed approval | Authorized through server/API and flow configuration for internal completion workflow | Authorized where assigned and allowed by workflow | Authorized where assigned and allowed by workflow | No | No |
| Work archived program | Read only | Read only | Read only | Read only | Read only |

### 6.4 Archived Program Rules

Archived programs are intentionally preserved. The app allows authorized users to keep viewing and downloading historical material, but blocks new work:

- No new uploads.
- No approval decisions.
- No new deliverable creation.
- No deliverable deletion by program owners.
- Program remains available in archived views for users who still have access.

### 6.5 Dataverse Security Roles

The preferred Dataverse model has two direct roles:

| Dataverse role | Assigned to | Purpose |
| --- | --- | --- |
| DRG Admin | DRG IT/admin users or admin group team | Human administrative support, controlled correction, troubleshooting, and cleanup. |
| DRG IMS Web App Service | Dataverse application user for the web app registration | Server-to-server CRUD after the web app has enforced user permissions. |

Program owners, DRG staff, and external reviewers should not receive direct Dataverse security roles unless DRG later chooses to expose a model-driven Dataverse app directly to those users.

## 7. Data Model Overview

| Entity | Purpose |
| --- | --- |
| `drg_program` | Contract/program master record. |
| `drg_programsite` | Program site rows. |
| `drg_programaccess` | Explicit user-to-program access assignment. |
| `drg_deliverabletype` | Configurable CDRL/SDRL/custom deliverable type list. |
| `drg_deliverable` | Contractual submission requirement. |
| `drg_document` | Metadata for a SharePoint-backed document. |
| `drg_documentaccesslog` | Audit row for uploads, external reviewer view/download activity, and workflow actions such as acknowledgment where configured. |
| `drg_approval` | Reviewer decision and approval history. |
| `systemuser` | Dataverse user lookup target for owners, creators, reviewers, and audit fields. |

SharePoint stores the files. Dataverse stores metadata, workflow state, relationships, and audit records.

## 8. Integration Details

### 8.1 Dataverse

Dataverse is accessed from server code using client credentials. The app supports either a client secret or certificate-based credential for the Dataverse application user.

Dataverse is responsible for:

- Programs.
- Program access.
- Deliverable types.
- Deliverables.
- Document metadata.
- Document access logs.
- Approval records.
- Business state used by dashboard, list, detail, calendar, and API views.

### 8.2 SharePoint

SharePoint stores uploaded files in a configured document library. The app creates folders based on program and deliverable identifiers unless a flat folder strategy is configured.

SharePoint responsibilities:

- Store PDF file binaries.
- Preserve document library versioning and file metadata.
- Provide file content to the app through Microsoft Graph.

### 8.3 Microsoft Graph

Microsoft Graph is used for:

- App-only SharePoint upload/download operations.
- Searching program owner and collaborator group members.
- Verifying user group membership for access assignment.
- Supporting external reviewer group-membership checks.

### 8.4 Power Automate

Power Automate handles workflow side effects after the app writes the correct Dataverse rows. Expected flows include:

- Program Owner Access Sync.
- Program Archive.
- Deliverable Type Normalize.
- Program Access Normalize.
- DRG Submission Created.
- Document view/download status updates.
- Reviewer response linking.
- Signed approval linking.
- Approval decision rollups.
- DRG acknowledgment of signed approval.
- Overdue status checks and notifications.

### 8.5 Teams

The Teams package in `teams-app/` contains a manifest template, icons, build script, and generated zip. Rebuild the zip whenever the deployed host changes.

## 9. Key API Endpoints

| Endpoint | Purpose | Permission behavior |
| --- | --- | --- |
| `GET /api/programs` | List visible programs. | Requires session; filters by admin/all or active program access. |
| `POST /api/programs` | Create program. | DRG admin only. |
| `PATCH /api/programs/[id]` | Update program details. | Admin or assigned program owner via access-management guard. |
| `DELETE /api/programs/[id]` | Delete program. | DRG admin only. |
| `GET /api/programs/[id]/access` | List program access. | User must be able to view the program. |
| `POST /api/programs/[id]/access` | Grant/reactivate program access. | Admin or assigned program owner. |
| `DELETE /api/programs/[id]/access` | Revoke program access. | Admin or assigned program owner. |
| `GET /api/deliverables` | List deliverables. | Requires session; data filtered to visible programs. |
| `POST /api/deliverables` | Create deliverable. | Admin, assigned program owner, or assigned staff draft path. |
| `PATCH /api/deliverables/[id]` | Update deliverable. | Requires create/work permission for the related program. |
| `DELETE /api/deliverables/[id]` | Delete deliverable. | Admin, or assigned program owner only when no documents exist. |
| `POST /api/deliverables/[id]/approve-draft` | Approve staff-created draft. | Admin or assigned program owner. |
| `GET/POST /api/deliverable-types` | List/create deliverable types. | Listing requires session; creation is limited to DRG admins, program owners, and DRG staff. |
| `POST /api/documents/submit` | Upload document metadata and file. | User must be able to upload to the program. |
| `GET /api/documents/[id]/download` | Stream document file. | User must be able to download from the program; external reviewer access is logged. |
| `POST /api/approvals/[id]/acknowledge` | Acknowledge signed approval. | Requires session and configured workflow; final enforcement is in app/flow logic. |
| `GET /api/users/program-owners` | Search eligible program owners. | DRG admin only. |
| `GET /api/users/program-collaborators` | Search eligible collaborators. | Requires signed-in session and configured Graph groups. |

## 10. Configuration and Environment Variables

The application depends on environment variables for production integrations. Important groups include:

| Area | Variables |
| --- | --- |
| Auth.js | `AUTH_SECRET`, `AUTH_URL` |
| Entra sign-in | `AUTH_MICROSOFT_ENTRA_ID_ID`, `AUTH_MICROSOFT_ENTRA_ID_SECRET`, `AUTH_MICROSOFT_ENTRA_ID_ISSUER` |
| Entra role groups | `ENTRA_DRG_ADMIN_GROUP_ID`, `ENTRA_DRG_PROGRAM_OWNER_GROUP_ID`, `ENTRA_DRG_STAFF_GROUP_ID`, `ENTRA_EXTERNAL_REVIEWER_GROUP_ID` |
| Dataverse | `DATAVERSE_ENVIRONMENT_URL`, `DATAVERSE_TENANT_ID`, `DATAVERSE_CLIENT_ID`, `DATAVERSE_CLIENT_SECRET`, or certificate credential variables |
| SharePoint | `SHAREPOINT_TENANT_ID`, `SHAREPOINT_CLIENT_ID`, `SHAREPOINT_CLIENT_SECRET`, `SHAREPOINT_SITE_ID`, `SHAREPOINT_SITE_URL`, `SHAREPOINT_DRIVE_ID` |
| SharePoint organization | `SHAREPOINT_DOCUMENT_FOLDER`, `SHAREPOINT_FOLDER_STRATEGY` |
| Power Automate | `POWER_AUTOMATE_APPROVAL_ACKNOWLEDGED_URL` for the one app-called instant flow; other imported flows are Dataverse-triggered or scheduled |
| Graph user/group lookup | `AZURE_TENANT_ID`, `AZURE_GRAPH_CLIENT_ID`, `AZURE_GRAPH_CLIENT_SECRET` |

When Dataverse or SharePoint is not configured, development paths may use mock connectors or disable upload behavior depending on the feature.

## 11. Security and Audit Considerations

The application follows these security principles:

- Authenticate every page and API route that exposes project data.
- Use Entra ID as the identity source.
- Map Entra roles/groups to internal application roles.
- Use program access rows for program-level authorization.
- Keep raw SharePoint URLs out of user-facing download flows.
- Log document access through `drg_documentaccesslog`.
- Keep direct Dataverse access limited to administrators and the web app service principal.
- Treat archived programs as read-only business records.
- Prefer archive over delete for real records.
- Use Microsoft cloud controls such as MFA, conditional access, tenant app consent, and least-privilege app registrations.

## 12. Testing and Quality

The repository includes:

- TypeScript unit/integration tests with Vitest.
- Python notification payload test.
- Java notification payload test.
- ESLint configuration.
- TypeScript configuration.

Useful commands:

```bash
pnpm test
pnpm test:all
pnpm lint
pnpm build
```

`pnpm test:all` runs the TypeScript suite, the Python notification test, and the Java/Maven notification payload test.

## 13. Deployment Overview

The prototype is hosted on Vercel. The intended long-term Microsoft-aligned deployment target is Azure App Service.

Deployment requires:

- Public app origin configured in `AUTH_URL` and `APP_URL`.
- Entra redirect URI: `<APP_URL>/api/auth/callback/microsoft-entra-id`.
- Entra app roles or group claims configured for all internal roles.
- Dataverse application user with the `DRG IMS Web App Service` role.
- SharePoint app registration with Graph access to the target site and drive.
- Power Automate solution imported, with `POWER_AUTOMATE_APPROVAL_ACKNOWLEDGED_URL` configured for the one app-called instant flow.
- Rebuilt Teams package for the final host.

## 14. Related Documentation

For deeper implementation details, see:

- [Dataverse Data Model](./dataverse-data-model.md)
- [Dataverse Security Roles](./dataverse-security-roles.md)
- [Power Automate Cloud Flows](./power-automate-cloud-flows.md)
- [App and Power Automate Integration Points](./app-flow-integration-points.md)
- [SharePoint Site Setup and Tenant Migration](./sharepoint-site-setup-and-tenant-migration.md)
- [Teams App README](../teams-app/README.md)
