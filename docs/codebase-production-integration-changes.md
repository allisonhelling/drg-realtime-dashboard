# Codebase Production Integration Status

This document records the current implementation state of the Next.js codebase relative to the Dataverse, SharePoint, Power Automate, and Entra design. Earlier versions of this document described a mostly mock-backed prototype. That work has since been implemented in the app layer.

Related implementation references:

- [dataverse-data-model.md](./dataverse-data-model.md)
- [power-automate-cloud-flows.md](./power-automate-cloud-flows.md)
- [dataverse-security-roles.md](./dataverse-security-roles.md)
- [process-handoff.md](./process-handoff.md)

## Current Project State

The application now uses:

- Next.js App Router with MUI components.
- Auth.js / NextAuth Microsoft Entra sign-in in `auth.ts`.
- Server-only Dataverse services in `src/lib/dataverse/`.
- Server-only SharePoint file services in `src/lib/sharepoint/files.ts`.
- Microsoft Graph user/group lookup in `src/lib/graph/users.ts`.
- Power Automate acknowledgment integration in `src/lib/power-automate/flows.ts`.
- Mock connectors retained only as local fallback fixtures when Dataverse is not configured.

Production routes and pages read through the Dataverse service layer rather than directly importing mock connectors. A test in `tests/typescript/productionIntegration.test.ts` protects that boundary.

## Implemented Integration Areas

### Dataverse Data Services

The code includes Dataverse client credentials support, including client-secret and certificate-based authentication. Service modules map Dataverse rows into app models for:

- Programs and program sites.
- Program access rows.
- Deliverable types.
- Deliverables.
- Documents and SharePoint file metadata.
- Approvals.
- Document access logs.

Choice values are resolved from Dataverse metadata when possible, with optional environment-variable overrides for tenants where numeric choice values need to be pinned explicitly.

### Authentication and Authorization

Role mapping supports the current internal roles:

- `drg-admin`
- `drg-program-owner`
- `drg-staff`
- `external-reviewer`

The UI can also derive `gov-reviewer` from active program access rows. Program visibility and action permissions are scoped by `drg_programaccess` and enforced on server routes before reads/writes are performed.

### Program Access

Program access is persisted in `drg_programaccess`, not client-only state. Admins can manage all programs. Program owners can manage access for programs where they have active Program Owner access. Users cannot revoke their own access through the app.

External reviewers must already exist in the DRG tenant and belong to the configured external reviewer group before the app can grant program access. The app verifies users and group membership through Microsoft Graph; it does not create external reviewer accounts.

### SharePoint Upload and Download

PDF uploads are written to the configured SharePoint document library. The app then creates `drg_document` metadata rows with SharePoint site, drive, item, URL, size, uploader, program, deliverable, role, and review due date fields.

Downloads go through the app API rather than exposing raw SharePoint URLs. The API checks program access, fetches the file using app credentials, and streams it back to the user.

### Audit Logs

The app creates `drg_documentaccesslog` rows for all uploads. For view/download activity, the app intentionally logs external reviewer actions. This focuses the audit trail on the customer/government receipt evidence that DRG needs for dispute scenarios while avoiding noisy internal read logs.

### Approval Workflow

External reviewers can act on current assigned approvals when they have active External Reviewer program access. The app supports:

- Reviewer response PDF upload.
- Signed approval PDF upload.
- Rejection with required comments.
- Approval only when a signed approval PDF is present.
- Internal acknowledgment of signed approvals.

Acknowledgment calls the configured `POWER_AUTOMATE_APPROVAL_ACKNOWLEDGED_URL` instant flow.

### Power Automate

Most workflow automation is Dataverse-triggered or scheduled. The app creates or updates Dataverse rows, and imported Power Automate flows handle status rollups, superseding, notifications, overdue transitions, and related side effects.

The attached Power App solution package includes flow artifacts such as:

- `DRGSubmissionCreated`
- `DocumentAccessLogCreated`
- `ExternalReviewerDownloadsSubmission`
- `ReviewerResponsePDFUploaded`
- `ReviewerResponseViewedByDRG`
- `ApprovalDecisionUpdated`
- `DRGAcknowledgesSignedApproval`
- `ProgramOwnerAccessSync`
- `ProgramAccessNormalize`
- `ProgramAccessRevoked`
- `DeliverableTypeNormalize`
- `ProgramArchive`
- `DeliverableDueDateOverdueCheck`
- `ReviewDueDateOverdueCheck`

Only `DRGAcknowledgesSignedApproval` is called directly by the app through an HTTP trigger. The other app-facing workflow integration points are Dataverse row creates/updates.

## Production Configuration Still Required

Before the app can run in DRG's final tenant, DRG IT still needs to configure:

- Entra sign-in app registration and redirect URI.
- Entra app roles or group claims for the four internal roles.
- Pre-created external reviewer users assigned to `ENTRA_EXTERNAL_REVIEWER_GROUP_ID`.
- Microsoft Graph app permissions for user and group lookup.
- Dataverse environment, `drg_*` tables, choices, lookups, security roles, and application user.
- SharePoint site/library, site ID, drive ID, and app permissions.
- Power Automate solution import and environment bindings.
- `POWER_AUTOMATE_APPROVAL_ACKNOWLEDGED_URL` for the one app-called instant flow.
- Final hosting environment variables.
- Teams app package rebuilt for the final host.

## Definition of Done

The codebase is aligned with the implemented production architecture when:

- Production routes do not directly import mock connectors.
- User-visible data is read from Dataverse and scoped by real program access.
- File uploads store PDFs in SharePoint and metadata in `drg_document`.
- Uploads and external reviewer downloads/views create `drg_documentaccesslog` rows.
- Submission, review, rejection, approval, acknowledgment, archive, revoke, and overdue states are driven by Dataverse rows and Power Automate flows.
- External reviewers are verified as existing tenant users in the configured external reviewer group.
- Admin, program owner, staff, and external reviewer experiences match their implemented security roles.

The automated TypeScript tests cover this integration layer with mocked Dataverse, SharePoint, Graph, and Power Automate responses. Final acceptance still requires a tenant-level UAT pass against DRG's actual Microsoft environment.
