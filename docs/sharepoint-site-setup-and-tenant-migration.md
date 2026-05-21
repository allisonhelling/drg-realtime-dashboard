# SharePoint Site Setup and Tenant Migration

This runbook describes how to set up the SharePoint document store used by DRG IMS and how to move that document store to a new SharePoint site in a different Microsoft 365 tenant.

The application uses SharePoint only for PDF file storage. Dataverse remains the system of record for programs, deliverables, document metadata, approvals, and access logs.

## What SharePoint Stores

SharePoint stores the binary PDF files submitted through the IMS app.

Dataverse stores the business metadata for each PDF:

- `drg_sharepointsiteurl`
- `drg_sharepointdriveid`
- `drg_sharepointitemid`
- `drg_sharepointurl`
- `drg_description`
- file name, file size, upload user, upload date, document role, review due date, and workflow status

Because Dataverse references SharePoint files by site URL, drive ID, item ID, and web URL, any tenant migration must update the Dataverse `drg_document` rows after files are copied or moved.

## Required SharePoint Shape

Create or select one SharePoint site for IMS document storage.

Recommended site:

```text
https://<tenant>.sharepoint.com/sites/drg-ims
```

Create one document library for submitted PDFs.

Recommended library:

```text
DRG IMS Documents
```

Create this base folder inside the document library:

```text
DRG Submissions
```

The app supports two folder strategies:

| Strategy | Environment value | SharePoint path |
| --- | --- | --- |
| Program and deliverable folders | `SHAREPOINT_FOLDER_STRATEGY=program-deliverable` | `DRG Submissions/<programId>/<deliverableId>/<timestamp>-<filename>.pdf` |
| Flat folder | `SHAREPOINT_FOLDER_STRATEGY=flat` | `DRG Submissions/<timestamp>-<filename>.pdf` |

Use `program-deliverable` for production because it is easier to inspect and recover files by business context. Use `flat` only for demos or when a single library folder is preferred.

The app creates SharePoint folders as part of app-owned activity. When an admin creates a program, the app creates the program folder. Before a document upload, the app verifies the full program/deliverable folder path exists and creates any missing folders.

Readable folder names use this format:

```text
DRG Submissions/
  <program ID> - <program name>/
    <deliverable ID> - <deliverable name>/
```

When a deliverable creation API is added, it should call the same SharePoint helper used by uploads so the deliverable folder is created immediately after the Dataverse deliverable row is created.

## SharePoint Versioning and Library Settings

Configure the document library with conservative document-management settings:

- Enable major versioning.
- Keep enough versions to satisfy DRG retention needs.
- Disable user-side deletion for external reviewers.
- Require modern authentication.
- Avoid required custom SharePoint metadata columns unless the app is updated to write them.
- Keep file names valid for SharePoint and Microsoft Graph. The app replaces these invalid path characters with hyphens: `\ / : * ? " < > |`.

The app itself enforces PDF-only uploads before sending content to SharePoint.

## Entra App Registration for SharePoint Uploads

Create a dedicated Microsoft Entra app registration for server-side SharePoint file access.

Use a separate app registration from the sign-in app if possible. The sign-in app authenticates users; the SharePoint upload app uses client credentials on the server.

Required values:

- Application client ID
- Client secret value
- Tenant ID
- Graph permission approved by a tenant admin

The app requests a Microsoft Graph token with:

```text
grant_type=client_credentials
scope=https://graph.microsoft.com/.default
```

The app uploads PDFs with a Graph request shaped like:

```text
PUT https://graph.microsoft.com/v1.0/sites/{siteId}/drives/{driveId}/root:/{path}:/content
```

For production, use the least-privileged permission model the tenant supports. A site-scoped model is preferred when available. If the tenant cannot support site-scoped app permissions, the client must approve an organization-appropriate Graph application permission that can write files to the target SharePoint document library.

## Environment Variables

Copy `.env.example` to `.env.local` and set the SharePoint variables:

```env
SHAREPOINT_TENANT_ID=<tenant-guid>
SHAREPOINT_CLIENT_ID=<sharepoint-upload-app-client-id>
SHAREPOINT_CLIENT_SECRET=<client-secret-value>
SHAREPOINT_SITE_ID=<tenant>.sharepoint.com,<site-collection-id>,<web-id>
SHAREPOINT_SITE_URL=https://<tenant>.sharepoint.com/sites/<site-name>
SHAREPOINT_DRIVE_ID=<document-library-drive-id>
SHAREPOINT_DOCUMENT_FOLDER=DRG Submissions
SHAREPOINT_FOLDER_STRATEGY=program-deliverable
```

`SHAREPOINT_SITE_URL` is stored into Dataverse for each document.

`SHAREPOINT_SITE_ID` and `SHAREPOINT_DRIVE_ID` are used by Microsoft Graph when uploading files.

`SHAREPOINT_DOCUMENT_FOLDER` defaults to `DRG Submissions`.

`SHAREPOINT_FOLDER_STRATEGY` defaults to `program-deliverable`.

## Finding Site and Drive IDs

Use Microsoft Graph Explorer, a script, or an admin tool with a user/app that can read the target SharePoint site.

Get the site ID by path:

```http
GET https://graph.microsoft.com/v1.0/sites/<tenant>.sharepoint.com:/sites/<site-name>
```

The response `id` is the value for `SHAREPOINT_SITE_ID`.

List the document libraries for the site:

```http
GET https://graph.microsoft.com/v1.0/sites/<site-id>/drives
```

Find the drive whose `name` matches the document library, then use its `id` as `SHAREPOINT_DRIVE_ID`.

## Dataverse Requirements

Before production uploads, the `drg_document` table must include these SharePoint columns:

- `drg_sharepointsiteurl`: URL, optional/admin metadata
- `drg_sharepointdriveid`: Text, required
- `drg_sharepointitemid`: Text, required
- `drg_sharepointurl`: URL, optional/admin metadata. User downloads must not redirect to this URL.
- `drg_description`: Multiline text, optional uploader-provided context

Create an alternate key across:

- `drg_sharepointdriveid`
- `drg_sharepointitemid`

This prevents two Dataverse document records from pointing to the same SharePoint file.

## Upload Flow

The intended production upload sequence is:

1. User uploads a PDF through `/submit`.
2. The app checks authentication and role/program access.
3. The app blocks non-PDF files.
4. The app blocks uploads to archived programs.
5. The app uploads the PDF to SharePoint.
6. The app creates a `drg_document` row in Dataverse with the new SharePoint IDs and URL.
7. The app creates a `drg_documentaccesslog` row with action `Upload`.
8. Power Automate handles downstream workflow: submission number, superseded documents, deliverable status, approvals, and notifications.

## Access Model

Do not rely on SharePoint folder permissions as the only access control layer.

The intended model is:

- Entra groups provide app-level roles.
- `drg_programaccess` controls program-specific access.
- The app checks those permissions before upload/download actions.
- SharePoint permissions should be aligned so users cannot bypass the app and access documents they should not see.

For external reviewers, the safest model is usually to let them access files through the IMS app rather than granting broad direct library access.

## Moving to a New Tenant

A tenant-to-tenant move has two separate parts:

1. Move or copy the SharePoint files.
2. Update the application configuration and Dataverse document metadata so existing IMS records point to the files in the new tenant.

There are three practical migration paths. Choose the path before creating the target SharePoint site. Microsoft's native cross-tenant migration expects to create the target site during migration; the controlled Graph copy and manual options expect the target site/library to exist first.

## Option A: Microsoft Cross-Tenant SharePoint Migration

Use this when the source and target tenants are eligible for Microsoft's cross-tenant SharePoint migration feature.

Microsoft's cross-tenant migration feature can move SharePoint sites between tenants using SharePoint Online PowerShell. Microsoft notes that this is a one-time move activity, not an incremental sync, and that availability depends on licensing/eligibility.

High-level steps:

1. Confirm source and target tenant eligibility.
2. Connect to both tenants with SharePoint Online PowerShell.
3. Establish trust between source and target tenants.
4. Verify trust.
5. Pre-create or map users and groups in the target tenant.
6. Prepare identity mapping.
7. Schedule and run the SharePoint site migration.
8. Complete post-migration validation.

After the Microsoft migration completes:

1. Create a new Entra app registration/client secret in the target tenant, or update the existing registration if it also moved.
2. Collect the new `SHAREPOINT_TENANT_ID`, `SHAREPOINT_CLIENT_ID`, `SHAREPOINT_CLIENT_SECRET`, `SHAREPOINT_SITE_ID`, `SHAREPOINT_SITE_URL`, and `SHAREPOINT_DRIVE_ID`.
3. Update the app environment variables.
4. Update each Dataverse `drg_document` row with the new SharePoint site URL, drive ID, item ID, and web URL.
5. Run upload and download smoke tests.

This option has the best chance of preserving native SharePoint structure, metadata, permissions, links, and version history, but the project should still validate every IMS document link because Dataverse stores IDs from the old tenant.

Do not manually create the target SharePoint site before using this option. Microsoft documents that the migration fails if the target site already exists.

## Option B: Controlled Copy with Microsoft Graph

Use this when the tenant is not eligible for the Microsoft cross-tenant migration feature, or when only the IMS document library needs to move.

This option copies files from the old site to the new site and creates an explicit mapping table from old SharePoint identifiers to new SharePoint identifiers.

Create a migration inventory from Dataverse:

```text
documentId
programId
deliverableId
fileName
oldSharePointSiteUrl
oldSharePointDriveId
oldSharePointItemId
oldSharePointUrl
```

For each document:

1. Download the source file:

   ```http
   GET https://graph.microsoft.com/v1.0/drives/{oldDriveId}/items/{oldItemId}/content
   ```

2. Upload it to the target library path:

   ```http
   PUT https://graph.microsoft.com/v1.0/sites/{newSiteId}/drives/{newDriveId}/root:/{targetPath}:/content
   ```

3. Capture the response fields:

   ```text
   newDriveId
   newItemId
   newWebUrl
   fileSize
   ```

4. Write a migration map:

   ```text
   documentId
   oldDriveId
   oldItemId
   oldWebUrl
   newSiteUrl
   newDriveId
   newItemId
   newWebUrl
   migratedOn
   migrationStatus
   ```

5. Update the matching Dataverse `drg_document` row:

   ```text
   drg_sharepointsiteurl = newSiteUrl
   drg_sharepointdriveid = newDriveId
   drg_sharepointitemid = newItemId
   drg_sharepointurl = newWebUrl
   ```

   The URL fields are retained for admin troubleshooting and migration traceability. The app should use `drg_sharepointdriveid` and `drg_sharepointitemid` to fetch files with Microsoft Graph and stream them through the download API.

This approach is clear and auditable, but it does not automatically preserve all SharePoint-native history. Treat version history, sharing links, created/modified metadata, and item-level permissions as separate requirements if DRG needs them preserved.

## Option C: Manual Export and Re-Upload

Use this only for a small demo data set.

Steps:

1. Export the old library files from SharePoint.
2. Create the new target site, library, and `DRG Submissions` folder.
3. Re-upload files into the new target library.
4. For each file, collect the new drive ID, item ID, and web URL.
5. Update Dataverse `drg_document` rows manually or with a script.
6. Test every document link in the IMS `/documents` page.

This option is simple but easiest to get wrong. It should not be used for production unless the number of files is very small and preserving version history is not required.

## Recommended DRG Migration Plan

For a real DRG tenant migration, use this order:

1. Freeze new document uploads in the app.
2. Export a Dataverse inventory of all current `drg_document` SharePoint references.
3. Choose the migration path.
4. If using Microsoft cross-tenant migration, do not pre-create the target SharePoint site. If using Graph/manual migration, create the target site, document library, and base folder.
5. Configure the target tenant app registration and Graph permissions.
6. Migrate files with Microsoft cross-tenant migration if eligible; otherwise use the controlled Graph copy approach.
7. Produce a migration map from old file IDs to new file IDs.
8. Update Dataverse `drg_document` SharePoint fields.
9. Update app environment variables.
10. Redeploy the app.
11. Run validation.
12. Unfreeze uploads.
13. Keep the source tenant read-only until DRG signs off.

## Validation Checklist

Validate configuration:

- `SHAREPOINT_TENANT_ID` is the target tenant.
- `SHAREPOINT_SITE_URL` opens in the target tenant.
- `SHAREPOINT_SITE_ID` matches the target site.
- `SHAREPOINT_DRIVE_ID` matches the target document library.
- The app registration can upload a test PDF.
- The app registration can read/download an uploaded test PDF.

Validate data:

- Every active `drg_document` row has a non-empty SharePoint site URL, drive ID, item ID, and web URL.
- No `drg_document` rows still point to the old tenant unless intentionally archived.
- The Dataverse alternate key does not block migrated rows because of duplicate SharePoint IDs.
- `/documents` lists migrated documents.
- `/documents/[id]` opens migrated document details.
- External reviewer download actions create `drg_documentaccesslog` rows.
- External reviewers can only access assigned program documents.
- DRG staff can upload a new PDF after migration.
- Power Automate submission and access-log flows still trigger in the target environment.

## Rollback Plan

Before changing Dataverse rows, export:

- A full `drg_document` table backup.
- The old-to-new SharePoint migration map.
- The previous app environment variables.

If migration validation fails:

1. Freeze uploads again.
2. Restore the old SharePoint environment variables.
3. Restore old SharePoint fields in Dataverse from backup.
4. Redeploy the app.
5. Confirm downloads work against the old tenant.

Avoid deleting the old site until the target tenant has passed validation and DRG has accepted the migration.

## Microsoft References

- Microsoft Graph: Get a SharePoint site by path: https://learn.microsoft.com/en-us/graph/api/site-getbypath
- Microsoft Graph: Get a SharePoint site: https://learn.microsoft.com/en-us/graph/api/site-get
- Microsoft Graph: List document libraries/drives: https://learn.microsoft.com/en-us/graph/api/drive-list
- Microsoft Graph: Upload or replace driveItem content: https://learn.microsoft.com/en-us/graph/api/driveitem-put-content
- Microsoft Graph: Download driveItem content: https://learn.microsoft.com/en-us/graph/api/driveitem-get-content
- Microsoft 365 Cross-tenant SharePoint migration overview: https://learn.microsoft.com/en-us/microsoft-365/enterprise/cross-tenant-sharepoint-migration
- Microsoft FastTrack cross-tenant migration overview: https://learn.microsoft.com/en-us/microsoft-365/fasttrack/cross-tenant-migration
