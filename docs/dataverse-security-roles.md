# Dataverse Security Roles

This document defines the preferred Dataverse security model for DRG IMS.

The web app is the primary access layer. Program owners, staff, and external reviewers authenticate with Entra ID and use the dashboard, but they should not receive direct Dataverse table access. The app enforces their permissions with Entra app roles/groups plus `drg_programaccess` records.

Direct Dataverse access should be limited to DRG IT/admin users and the server-to-server application user used by the web app.

## Access Model

| Actor | Dataverse access | Purpose |
| --- | --- | --- |
| `drg_admins` / DRG IT | Direct human access | Environment support, data correction, controlled administrative actions, and troubleshooting. |
| DRG IMS web app application user | Server-to-server access | The Next.js app reads/writes Dataverse through client credentials. |
| `drg_program_owners` | No direct Dataverse role | Use the web app. App checks Entra role and `drg_programaccess`. |
| `drg_staff` | No direct Dataverse role | Use the web app. App checks Entra role and `drg_programaccess`. |
| `external_reviewers` | No direct Dataverse role | Use the web app. App checks Entra role and `drg_programaccess`. |

Do not create Dataverse group teams for `drg_program_owners`, `drg_staff`, or `external_reviewers` unless DRG later decides to expose a model-driven Dataverse app directly to those users. If that decision changes, define a separate direct-user security model and test record ownership/sharing carefully.

## Permission Scope Legend

| Scope | Meaning |
| --- | --- |
| None | No table privilege. |
| User | Records owned by the user or a team the user belongs to. |
| Business Unit | Records in the user's business unit. |
| Parent: Child BU | Records in the user's business unit and child units. |
| Organization | All records in the environment. |

For this deployment model, the two Dataverse roles below mostly use `Organization` scope because the app and DRG IT support the whole IMS dataset. End-user scoping is handled in the web app, not by direct Dataverse table privileges.

## Recommended Roles

Create these custom roles in Power Platform admin center under Environment > Settings > Users + permissions > Security roles.

### DRG Admin

Assign this role to the Dataverse group team backed by the `drg_admins` Entra group, or assign it directly to named DRG IT administrators.

| Field | Value |
| --- | --- |
| Role Name | `DRG Admin` |
| Description | Direct Dataverse administration role for DRG IT users who support IMS data, configuration, troubleshooting, archiving, and controlled cleanup. |
| Applies To | DRG IMS / DRG Realtime Dashboard |
| Summary of Core Table Privileges | Organization-level access to DRG custom tables. Delete is available only where DRG intends admins to permanently remove records. |
| When role is assigned to a Team | Team member gets all team privileges by default. |
| Member's privilege inheritance | Direct User (Basic) access level and Team privileges. |

| Dataverse table | Create | Read | Write | Delete | Append | Append To | Assign | Share |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `contact` | None | None | None | None | None | None | None | None |
| `drg_approval` | Organization | Organization | Organization | See delete policy | Organization | Organization | Organization | Organization |
| `drg_deliverable` | Organization | Organization | Organization | See delete policy | Organization | Organization | Organization | Organization |
| `drg_deliverabletype` | Organization | Organization | Organization | None | Organization | Organization | Organization | Organization |
| `drg_document` | Organization | Organization | Organization | See delete policy | Organization | Organization | Organization | Organization |
| `drg_documentaccesslog` | Organization | Organization | Organization | See delete policy | Organization | Organization | Organization | Organization |
| `drg_program` | Organization | Organization | Organization | See delete policy | Organization | Organization | Organization | Organization |
| `drg_programaccess` | Organization | Organization | Organization | See delete policy | Organization | Organization | Organization | Organization |
| `drg_programsite` | Organization | Organization | Organization | See delete policy | Organization | Organization | Organization | Organization |
| `systemuser` | None | Organization | None | None | None | Organization | None | None |

Notes:

- DRG admins can create programs and manage administrative cleanup.
- DRG admins can archive programs by updating `drg_program.drg_status = Archived`.
- Prefer archive for real business records. Use delete for setup mistakes, test data, or an explicitly approved data-retention workflow.
- Use Dataverse System Administrator only for environment/platform administration.

### DRG IMS Web App Service

Assign this role to the Dataverse Application User for the app registration configured by `DATAVERSE_CLIENT_ID`.

| Field | Value |
| --- | --- |
| Role Name | `DRG IMS Web App Service` |
| Description | Server-to-server role used by the Next.js web app to perform all application data operations after the app has enforced user authorization. |
| Applies To | DRG IMS / DRG Realtime Dashboard |
| Summary of Core Table Privileges | Organization-level CRUD needed by the web app. Delete should match the implemented app behavior and DRG retention policy. |
| Assignment | Dataverse Application User only. Do not assign this role to human users. |

| Dataverse table | Create | Read | Write | Delete | Append | Append To | Assign | Share |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `contact` | None | None | None | None | None | None | None | None |
| `drg_approval` | Organization | Organization | Organization | See delete policy | Organization | Organization | Organization | Organization |
| `drg_deliverable` | Organization | Organization | Organization | See delete policy | Organization | Organization | Organization | Organization |
| `drg_deliverabletype` | Organization | Organization | Organization | None | Organization | Organization | Organization | Organization |
| `drg_document` | Organization | Organization | Organization | See delete policy | Organization | Organization | Organization | Organization |
| `drg_documentaccesslog` | Organization | Organization | Organization | See delete policy | Organization | Organization | Organization | Organization |
| `drg_program` | Organization | Organization | Organization | See delete policy | Organization | Organization | Organization | Organization |
| `drg_programaccess` | Organization | Organization | Organization | See delete policy | Organization | Organization | Organization | Organization |
| `drg_programsite` | Organization | Organization | Organization | See delete policy | Organization | Organization | Organization | Organization |
| `systemuser` | None | Organization | None | None | None | Organization | None | None |

Notes:

- The web app service role is powerful by design. User-level authorization must be enforced before every write, archive, delete, upload, download, approval, and access-management action.
- Program-specific access is still represented by `drg_programaccess`; it is application data, not a direct Dataverse security boundary for non-admin users.
- Keep this application user's client secret or certificate restricted to the hosting environment.

## Delete Policy

Current production-safe recommendation:

| Table | Delete recommendation |
| --- | --- |
| `drg_program` | Enable only when the app has an admin-only delete action. |
| `drg_programsite` | Enable if deleting a program should clean up setup/site rows. |
| `drg_programaccess` | Enable if deleting a program should clean up access rows. |
| `drg_deliverable` | Enable only when full cascade delete is intentionally implemented. |
| `drg_document` | Enable only when full cascade delete is intentionally implemented and SharePoint cleanup is handled. |
| `drg_approval` | Enable only when full cascade delete is intentionally implemented. |
| `drg_documentaccesslog` | Avoid deleting unless DRG approves deleting audit history. |
| `drg_deliverabletype` | Keep delete off; deactivate or rename reference values instead. |

Recommended staged rollout:

1. **Archive first:** implement admin-only archive by updating `drg_program.drg_status = Archived`.
2. **Delete empty/test programs:** allow admin-only delete only when the program has no deliverables, documents, approvals, or audit logs. The app may delete simple setup children such as `drg_programsite` and `drg_programaccess`.
3. **Full cascading delete:** enable broader delete privileges only after the app implements an explicit cascade plan, confirmation UI, SharePoint file cleanup, and audit/retention approval.

Do not enable blanket delete privileges simply because the app may need them later. Grant them when the app behavior and DRG retention decision are ready.

## Application Role Enforcement

The following roles are still used by the web app, but they should not receive Dataverse security roles in the IT-only Dataverse model:

| Entra group/app role | Web app behavior |
| --- | --- |
| `drg_program_owners` | May manage assigned programs and access through the app when an active `Program Owner` `drg_programaccess` row exists. |
| `drg_staff` | May work assigned programs and upload DRG submissions through the app when an active `DRG Staff` or `Program Owner` access row exists. |
| `external_reviewers` | May review assigned work through the app when an active `External Reviewer` access row exists. |

The app must enforce:

- Only DRG admins can create programs.
- Only DRG admins can archive programs.
- Only DRG admins can delete programs.
- Program owners can manage access only for programs where they have active owner access.
- Staff and external reviewers can only work programs where they have active access.
- Archived programs remain readable to authorized users but block new uploads and approval actions.

## Lookup and Relationship Privileges

Dataverse lookups commonly require both sides of a relationship to have privileges:

- **Append** on the record being linked from.
- **Append To** on the record being linked to.

Examples:

- Creating a `drg_document` linked to a `drg_deliverable` usually requires Append on `drg_document` and Append To on `drg_deliverable`.
- Creating a `drg_programaccess` row linked to a `drg_program` and `systemuser` usually requires Append on `drg_programaccess` and Append To on the related parent records.
- Creating a `drg_approval` linked to `drg_program`, `drg_deliverable`, and `drg_document` requires the appropriate Append and Append To privileges across those tables.

Because the web app service role creates these records server-side, the service role needs the relevant Append and Append To privileges at Organization scope.

## System Table Access

Keep `systemuser` read access because the model uses lookups to `systemuser` for creators, owners, assigned staff, reviewers, uploaders, viewers, and grant/revoke users.

Keep `Append To` on `systemuser` where the app creates records that reference a user lookup, such as `drg_programaccess.drg_user`, `drg_approval.drg_revieweruser`, or `drg_document.drg_uploadedby`.

`contact` is not used by the current data model. External reviewers are expected to be pre-created in Entra and assigned to the configured external reviewer group, so any Dataverse user lookup references point at `systemuser`, not `contact`. Leave `contact` as None unless DRG adds a separate external reviewer directory or customer/contact management feature.

## Tenant Migration Notes

When moving from the development tenant to the final tenant:

1. Export these custom security roles in a solution.
2. Import the solution into the final tenant environment.
3. Recreate or rebind the `drg_admins` Dataverse group team for the final tenant's Entra group.
4. Create the Dataverse Application User for the final web app registration.
5. Assign `DRG Admin` to the admin group team or named DRG IT users.
6. Assign `DRG IMS Web App Service` to the application user.
7. Do not assign Dataverse roles to program owners, staff, or external reviewers unless DRG intentionally adopts direct Dataverse/model-driven access for those groups.
8. Re-test with one admin and one user from each web app role to confirm the dashboard permissions work without direct Dataverse access.
