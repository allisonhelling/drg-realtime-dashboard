# Power Automate Cloud Flows

This document lists the cloud flows needed to support the Dataverse workflow in [dataverse-data-model.md](./dataverse-data-model.md).

Use Dataverse trigger filters wherever possible so flows only run for relevant rows. Use the app for immediate user-facing validation when the user needs a friendly error before save.

This file describes what each flow action does at an implementation level. The supplied solution package contains Dataverse-triggered and scheduled flows for most workflow side effects. The Next.js app directly calls only the `DRG Acknowledges Signed Approval` instant flow through `POWER_AUTOMATE_APPROVAL_ACKNOWLEDGED_URL`.

Power Automate usually shows Dataverse table names as plural display names. The schema names in this document are singular, so select the matching plural table in Power Automate, for example:

- `drg_program` -> `drg_programs`
- `drg_programaccess` -> `drg_programaccesses`
- `drg_deliverable` -> `drg_deliverables`
- `drg_deliverabletype` -> `drg_deliverabletypes`
- `drg_document` -> `drg_documents`
- `drg_documentaccesslog` -> `drg_documentaccesslogs`
- `drg_approval` -> `drg_approvals`
- `systemuser` -> `Users`

For lookup row IDs, use the raw Dataverse lookup value from dynamic content when available. Those values usually look like `_drg_program_value`, `_drg_owneruser_value`, `_drg_document_value`, and so on.

For Dataverse choice columns, Power Automate often stores generated numeric values even when the UI shows labels such as Program Owner, Pending, or Archived. The steps below name the intended label; when entering an OData Filter rows value, replace the label with the numeric value from your Dataverse choice if Power Automate does not accept the label.

## 1. Program Owner Access Sync

Flow type: Automated cloud flow

Trigger:

- Dataverse: When a row is added, modified, or deleted
- Change type: Added or modified
- Table name: `drg_programs`
- Scope: Organization
- Select columns: `drg_owneruser`
- Filter rows: `statecode eq 0 and _drg_owneruser_value ne null`
- Trigger condition:
  - Owner user lookup is populated.

Actions:

- Get the program row:
  - Action: Dataverse `Get a row by ID`
  - Table name: `drg_programs`
  - Row ID: program row from the trigger.
- Get owner user details:
  - Action: Dataverse `Get a row by ID`
  - Table name: `Users`
  - Row ID: `_drg_owneruser_value` from the program row
- Compose owner email:
  - Action: Data Operations `Compose`
  - Inputs: normalized owner email from the owner user row.
  - If `internalemailaddress` is blank in your environment, use `domainname` instead.
- List existing owner access rows:
  - Action: Dataverse `List rows`
  - Table name: `drg_programaccesses`
  - Filter to the current program and normalized owner email.
  - Row count: `1`
- Condition: check whether an access row exists:
  - Action: Control `Condition`
  - Condition: existing owner access row count is zero.
  - If yes:
    - Create a `drg_programaccess` row for the owner.
    - Set the program lookup, owner user lookup, normalized owner email, Program Owner role, active flag, grant timestamp, and grant actor fields.
  - If no:
    - Update the existing access row.
    - Set the Program Owner role and reactivate the row.

Notes:

- This flow keeps the explicit program access table aligned with the owner assigned on `drg_program`.

## 2. Program Archive

Flow type: Automated cloud flow

Trigger:

- Dataverse: When a row is added, modified, or deleted
- Change type: Modified
- Table name: `drg_programs`
- Scope: Organization
- Select columns: `drg_status`
- Filter rows: `statecode eq 0 and drg_status eq <Archived choice value>`
- Trigger condition:
  - Program status is Archived.

Actions:

- Get the program row:
  - Action: Dataverse `Get a row by ID`
  - Table name: `drg_programs`
  - Row ID: program row from the trigger.
- Condition: check whether `drg_archivedon` is blank:
  - Action: Control `Condition`
  - Condition: `drg_archivedon` is equal to null
  - If yes:
    - Update the program row with archive timestamp and archive actor.
  - If no:
    - Do nothing; the archive stamp already exists.
- List active deliverables for the program:
  - Action: Dataverse `List rows`
  - Table name: `drg_deliverables`
  - Filter to active deliverables for the archived program.
- Optional: for each open deliverable, update the deliverable if the app needs a separate archived/hidden view state.
- List current documents for the program:
  - Action: Dataverse `List rows`
  - Table name: `drg_documents`
  - Filter to current documents for the archived program.
- Optional: for each visible document, update `drg_status` to Archived if the app should hide documents by document status.

Notes:

- The app should block new uploads when the parent program is archived.
- Downloads and analytics should remain available.

## 3. Deliverable Type Normalize

Flow type: Automated cloud flow

Trigger:

- Dataverse: When a row is added, modified, or deleted
- Change type: Added or modified
- Table name: `drg_deliverabletypes`
- Scope: Organization
- Select columns: `drg_name`
- Filter rows: `statecode eq 0 and drg_name ne null`
- Trigger condition:
  - Deliverable type name is populated.

Actions:

- Compose normalized name:
  - Action: Data Operations `Compose`
  - Inputs: lower-cased, trimmed deliverable type name.
- Condition: check whether `drg_normalizedname` already matches:
  - Action: Control `Condition`
  - Condition: `drg_normalizedname` is not equal to the compose output
  - If yes:
    - Update the deliverable type with the normalized name.
  - If no:
    - Do nothing.

Notes:

- The app should also set `drg_normalizedname` before creating the row so the alternate key can catch duplicates immediately.
- Alternate key: `drg_normalizedname`.

## 4. Program Access Normalize

Flow type: Automated cloud flow

Trigger:

- Dataverse: When a row is added, modified, or deleted
- Change type: Added or modified
- Table name: `drg_programaccesses`
- Scope: Organization
- Select columns: `drg_email`
- Filter rows: `statecode eq 0 and drg_email ne null`
- Trigger condition:
  - Program access email is populated.

Actions:

- Compose normalized email:
  - Action: Data Operations `Compose`
  - Inputs: lower-cased, trimmed program access email.
- Condition: check whether `drg_email` already matches:
  - Action: Control `Condition`
  - Condition: `drg_email` is not equal to the compose output
  - If yes:
    - Update the program access row with the normalized email.
  - If no:
    - Do nothing.

Notes:

- The app should also normalize email before creating the row.
- Alternate key: `drg_program` + `drg_email`.

## 5. DRG Submission Created

Flow type: Automated cloud flow

Trigger:

- Dataverse: When a row is added, modified, or deleted
- Change type: Added
- Table name: `drg_documents`
- Scope: Organization
- Filter rows: `statecode eq 0`
- Trigger condition:
  - Document role is DRG Submission.

Actions:

- Get the new document row:
  - Action: Dataverse `Get a row by ID`
  - Table name: `drg_documents`
  - Row ID: `drg_document` from the trigger
- Get parent deliverable:
  - Action: Dataverse `Get a row by ID`
  - Table name: `drg_deliverables`
  - Row ID: `_drg_deliverable_value` from the document row
- Get parent program:
  - Action: Dataverse `Get a row by ID`
  - Table name: `drg_programs`
  - Row ID: `_drg_program_value` from the document row
- Condition: validate parent program is not archived:
  - Action: Control `Condition`
  - Condition: parent program status is not Archived.
  - If no:
    - Terminate the flow as Failed or Cancelled.
  - If yes:
    - List previous current DRG submission documents:
      - Action: Dataverse `List rows`
      - Table name: `drg_documents`
      - Filter to current submission documents for the same deliverable, excluding the new document.
    - For each previous current submission, update the document:
      - Action: Dataverse `Update a row`
      - Table name: `drg_documents`
      - Row ID: current item `drg_documentid`
      - `drg_status`: Outdated
      - `drg_iscurrentversion`: No
      - `drg_supersededbydocument`: new document
      - `drg_supersededon`: current date/time
    - Calculate next submission number:
      - Action: Data Operations `Compose`
      - if deliverable `drg_currentsubmissionnumber` is blank, use `1`
      - otherwise use `drg_currentsubmissionnumber + 1`
    - Update new document:
      - Action: Dataverse `Update a row`
      - Table name: `drg_documents`
      - Row ID: new document row ID
      - `drg_submissionnumber`: calculated number
      - `drg_status`: Submitted
      - `drg_iscurrentversion`: Yes
    - Update parent deliverable:
      - Action: Dataverse `Update a row`
      - Table name: `drg_deliverables`
      - Row ID: parent deliverable row ID
      - `drg_status`: Submitted
      - `drg_currentsubmissionnumber`: calculated number
      - `drg_lastsubmittedon`: current date/time
      - `drg_isclosed`: No
    - List active external reviewer access rows:
      - Action: Dataverse `List rows`
      - Table name: `drg_programaccesses`
      - Filter to active External Reviewer access rows for the parent program.
    - For each external reviewer, create an approval:
      - Action: Dataverse `Add a new row`
      - Table name: `drg_approvals`
      - `drg_name`: `{deliverable number} submission {submission number} | {reviewer email}`
      - `drg_program`: parent program
      - `drg_deliverable`: parent deliverable
      - `drg_document`: new document
      - `drg_submissionnumber`: calculated number
      - `drg_revieweruser`: reviewer user
      - `drg_revieweremail`: reviewer email
      - `drg_decision`: Pending
      - `drg_duedate`: new document `drg_reviewduedate`
      - `drg_iscurrent`: Yes
    - List older current approvals for the deliverable:
      - Action: Dataverse `List rows`
      - Table name: `drg_approvals`
      - Filter to current approvals for the same deliverable.
    - For each older approval that is not one of the approvals just created, update the approval:
      - Action: Dataverse `Update a row`
      - Table name: `drg_approvals`
      - Row ID: current item `drg_approvalid`
      - `drg_iscurrent`: No
    - Send notification to each external reviewer:
      - Action: Office 365 Outlook `Send an email (V2)`, Teams `Post message`, or your selected notification connector
      - include program name/number
      - deliverable title/number
      - app document link, for example `{APP_URL}/documents/{drg_documentid}`
      - review due date if provided

Notes:

- This is the core submission flow.
- The app should prevent non-PDF uploads before the Dataverse row is created.

## 6. External Reviewer Downloads Submission

Flow type: Automated cloud flow

Trigger:

- Dataverse: When a row is added, modified, or deleted
- Change type: Added
- Table name: `drg_documentaccesslogs`
- Scope: Organization
- Filter rows: `statecode eq 0`
- Trigger condition:
  - `drg_action = Download` or `drg_action = View`
  - `drg_result = Success`, if the optional result column is implemented
  - actor has `External Reviewer` access

Actions:

- Get the access log row:
  - Action: Dataverse `Get a row by ID`
  - Table name: `drg_documentaccesslogs`
  - Row ID: `drg_documentaccesslog` from the trigger
- Get related document:
  - Action: Dataverse `Get a row by ID`
  - Table name: `drg_documents`
  - Row ID: `_drg_document_value` from the access log row
- Get related deliverable:
  - Action: Dataverse `Get a row by ID`
  - Table name: `drg_deliverables`
  - Row ID: `_drg_deliverable_value` from the document row
- List active external reviewer access for the actor:
  - Action: Dataverse `List rows`
  - Table name: `drg_programaccesses`
  - Filter to active access rows for the related document's program and the access log actor email.
  - Row count: `1`
- Condition: continue only if this is a valid external reviewer access event:
  - Action: Control `Condition`
  - `drg_documentrole = DRG Submission`
  - `drg_iscurrentversion = Yes`
  - `drg_status = Submitted`
  - `drg_result = Success`, if the optional result column is implemented
  - the active external reviewer access list contains one row
  - If yes:
    - Update the document to Under Review and stamp viewed-by fields from the access log.
    - Update the related deliverable to In Review.
    - List the current approval row for this document and reviewer.
    - If an approval row is found and decision is blank, set the decision to Pending.
  - If no:
    - Do not update document, deliverable, or approval status.

Notes:

- If approval rows are created with `Pending` immediately, the last action may not be needed.

## 7. Reviewer Response PDF Uploaded

Flow type: Automated cloud flow

Trigger:

- Dataverse: When a row is added, modified, or deleted
- Change type: Added
- Table name: `drg_documents`
- Scope: Organization
- Filter rows: `statecode eq 0 and _drg_parentdocument_value ne null`
- Trigger condition:
  - `drg_documentrole = Reviewer Response` or `Signed Approval`

Actions:

- Get the reviewer document row:
  - Action: Dataverse `Get a row by ID`
  - Table name: `drg_documents`
  - Row ID: `drg_document` from the trigger
- Condition: validate parent document exists:
  - Action: Control `Condition`
  - Condition: `_drg_parentdocument_value` is not empty
  - If yes:
    - Continue with the next action below.
  - If no:
    - Terminate the flow as Failed or Cancelled.
- Get parent DRG submission document:
  - Action: Dataverse `Get a row by ID`
  - Table name: `drg_documents`
  - Row ID: `_drg_parentdocument_value` from the reviewer document
- List the related current approval:
  - Action: Dataverse `List rows`
  - Table name: `drg_approvals`
  - Filter to the parent DRG submission document, the reviewer document uploader email, and current approvals.
  - Row count: `1`
- Update reviewer document:
  - Action: Dataverse `Update a row`
  - Table name: `drg_documents`
  - Row ID: reviewer document row ID
  - `drg_program`: parent document program if blank
  - `drg_deliverable`: parent document deliverable if blank
  - `drg_submissionnumber`: parent document submission number
  - `drg_approval`: current approval row
- Condition: if document role is `Signed Approval`:
  - Action: Control `Condition`
  - If yes:
    - Update the current approval so `drg_responsedocument` points to the signed approval document.
  - If no:
    - Continue to the Reviewer Response condition.
- Condition: if document role is `Reviewer Response`:
  - Action: Control `Condition`
  - If yes:
    - Update the current approval so `drg_responsedocument` points to the reviewer response document.
  - If no:
    - Do nothing.

Notes:

- The reviewer decision flow still controls whether the decision is Approved or Rejected.

## 8. Approval Decision Updated

Flow type: Automated cloud flow

Trigger:

- Dataverse: When a row is added, modified, or deleted
- Change type: Modified
- Table name: `drg_approvals`
- Scope: Organization
- Select columns: `drg_decision,drg_responsedocument,drg_comments`
- Filter rows: `statecode eq 0 and drg_iscurrent eq true`
- Trigger condition:
  - `drg_decision = Approved` or `drg_decision = Rejected`
  - `drg_iscurrent = Yes`

Actions:

- Get the approval row:
  - Action: Dataverse `Get a row by ID`
  - Table name: `drg_approvals`
  - Row ID: `drg_approval` from the trigger
- Get related document:
  - Action: Dataverse `Get a row by ID`
  - Table name: `drg_documents`
  - Row ID: `_drg_document_value` from the approval row
- Get related deliverable:
  - Action: Dataverse `Get a row by ID`
  - Table name: `drg_deliverables`
  - Row ID: `_drg_deliverable_value` from the approval row
- Condition branch: if `drg_decision = Rejected`:
  - Action: Control `Condition`
  - If yes:
    - Verify rejection comments contain data. If comments are blank, terminate the flow as Failed or Cancelled.
    - Update approval decision date if blank.
    - Update the DRG submission document to Returned.
    - Update the deliverable to Returned.
    - Notify DRG staff/program owner with reviewer comments and an app link to the reviewer response document if provided.
  - If no:
    - Continue to the Approved decision branch.
- Condition branch: if `drg_decision = Approved`:
  - Action: Control `Condition`
  - If yes:
    - Get the response document.
    - Verify response document role is Signed Approval. If not, terminate the flow as Failed or Cancelled.
    - Update approval decision date if blank.
    - Update the DRG submission document to Reviewed.
    - Update the deliverable to Pending Acknowledgment and stamp `drg_lastapprovedon`.
    - Notify DRG staff/program owner that signed approval is ready for acknowledgment, using an app link to the signed approval document.
  - If no:
    - Do nothing.

Notes:

- The app should prevent Approved without signed PDF and Rejected without comments before the row is saved.
- This flow is the backup enforcement and status rollup.

## 9. DRG Acknowledges Signed Approval

Flow type: Instant cloud flow

Trigger:

- Power Automate: `When an HTTP request is received`
- Method: `POST`
- The generated HTTP POST URL goes into `POWER_AUTOMATE_APPROVAL_ACKNOWLEDGED_URL`.
- Request body:

```json
{
  "type": "object",
  "properties": {
    "deliverableId": { "type": "string" },
    "acceptedSubmissionDocumentId": { "type": "string" },
    "signedApprovalDocumentId": { "type": "string" },
    "approvalId": { "type": "string" },
    "acknowledgedByEmail": { "type": "string" },
    "acknowledgedByName": { "type": "string" },
    "acknowledgedByUserId": { "type": "string" }
  },
  "required": [
    "deliverableId",
    "acceptedSubmissionDocumentId",
    "signedApprovalDocumentId",
    "acknowledgedByEmail"
  ]
}
```

Actions:

- Get deliverable:
  - Action: Dataverse `Get a row by ID`
  - Table name: `drg_deliverables`
  - Row ID: `deliverableId` from the HTTP request body.
- Get accepted DRG submission document:
  - Action: Dataverse `Get a row by ID`
  - Table name: `drg_documents`
  - Row ID: `acceptedSubmissionDocumentId` from the HTTP request body.
- Get signed approval document:
  - Action: Dataverse `Get a row by ID`
  - Table name: `drg_documents`
  - Row ID: `signedApprovalDocumentId` from the HTTP request body.
- Optional: resolve the acknowledging Dataverse user:
  - Action: Dataverse `List rows`
  - Table name: `Users`
  - Filter to `internalemailaddress` or `domainname` matching `acknowledgedByEmail`.
  - Row count: `1`
  - Use this row for `drg_acknowledgedby` and `drg_actoruser` when found. Do not assume `acknowledgedByUserId` is a Dataverse `systemuser` ID unless the app has been configured to send that exact ID.
- Condition: validate acknowledgment is allowed:
  - Action: Control `Condition`
  - deliverable status is `Pending Acknowledgment`
  - accepted document role is `DRG Submission`
  - signed approval document role is `Signed Approval`
  - signed approval belongs to the same deliverable/program context as the accepted submission.
  - user authorization is enforced in the app before the HTTP request; the flow may optionally add a backup check by matching `acknowledgedByEmail` to active program owner/staff access.
  - If yes:
    - Update accepted DRG submission document to Final.
    - Update signed approval document to Final or Reviewed.
    - Update deliverable to Complete, close it, and stamp acknowledgment fields.
    - Create a document access log row with action Acknowledge and result Success.
    - Notify external reviewer(s) and DRG staff that the deliverable is complete, using app links.
    - Return an HTTP `200` response with body `{ "ok": true, "acknowledged": true }`.
  - If no:
    - Return an HTTP `400` or `409` response with body `{ "ok": false, "error": "<reason>" }`.

Notes:

- This should be an explicit user action, not automatic on approval.
- This must be an HTTP-triggered flow, not a manual button flow, because the Next.js app calls it with `fetch()`.
- Any email links should use the deployed app URL, for example `{APP_URL}/documents/{signedApprovalDocumentId}`, not a SharePoint direct link.

## 10. Reviewer Response Viewed By DRG

Flow type: Automated cloud flow

Implementation note: the current app logs uploads and external reviewer view/download activity. It does not create access-log rows for ordinary internal DRG downloads/views, so this flow only fires if DRG later enables internal view/download logging or creates equivalent log rows from another process.

Trigger:

- Dataverse: When a row is added, modified, or deleted
- Change type: Added
- Table name: `drg_documentaccesslogs`
- Scope: Organization
- Filter rows: `statecode eq 0`
- Trigger condition:
  - `drg_action = Download` or `drg_action = View`
  - `drg_result = Success`, if the optional result column is implemented
  - actor is DRG staff/program owner/admin

Actions:

- Get access log row:
  - Action: Dataverse `Get a row by ID`
  - Table name: `drg_documentaccesslogs`
  - Row ID: `drg_documentaccesslog` from the trigger
- Get related document:
  - Action: Dataverse `Get a row by ID`
  - Table name: `drg_documents`
  - Row ID: `_drg_document_value` from the access log row
- Condition: continue only if the document role is Reviewer Response:
  - Action: Control `Condition`
  - Condition: related document `drg_documentrole` is equal to Reviewer Response
  - If yes:
    - Update reviewer response document to Viewed and stamp viewed-by fields from the access log.
  - If no:
    - Do nothing.

## 11. Review Due Date Overdue Check

Flow type: Scheduled cloud flow

Trigger:

- Recurrence
- Suggested cadence: once per day, early morning

Actions:

- List overdue approvals:
  - Action: Dataverse `List rows`
  - Table name: `drg_approvals`
  - Filter to current pending approvals whose due date is earlier than now.
- For each approval:
  - Get related document:
    - Action: Dataverse `Get a row by ID`
    - Table name: `drg_documents`
    - Row ID: `_drg_document_value` from the approval row
  - Get related deliverable:
    - Action: Dataverse `Get a row by ID`
    - Table name: `drg_deliverables`
    - Row ID: `_drg_deliverable_value` from the approval row
  - If document is not already Final, Returned, or Reviewed, update the document:
    - Action: Dataverse `Update a row`
    - Table name: `drg_documents`
    - Row ID: related document row ID
    - `drg_status`: Overdue - Waiting on Reviewer
  - If deliverable is not Complete, update the deliverable:
    - Action: Dataverse `Update a row`
    - Table name: `drg_deliverables`
    - Row ID: related deliverable row ID
    - `drg_status`: Overdue - Waiting on Reviewer
  - Notify reviewer and DRG staff/program owner:
    - Action: Office 365 Outlook `Send an email (V2)`, Teams `Post message`, or your selected notification connector

Notes:

- This handles the optional approval due date on the submitted document/review request.

## 12. Deliverable Due Date Overdue Check

Flow type: Scheduled cloud flow

Trigger:

- Recurrence
- Suggested cadence: once per day, early morning

Actions:

- List overdue deliverables:
  - Action: Dataverse `List rows`
  - Table name: `drg_deliverables`
  - Filter to active deliverables whose due date is earlier than now.
- For each deliverable:
  - Skip if `drg_status` is Complete.
  - Determine blocking party:
    - Action: Control `Condition` or `Switch`
    - if status is `Submitted`, `In Review`, or document/approval is pending, use `Overdue - Waiting on Reviewer`
    - if status is `Returned`, `Pending Acknowledgment`, or `Not Submitted`, use `Overdue - Waiting on DRG`
  - Update deliverable:
    - Action: Dataverse `Update a row`
    - Table name: `drg_deliverables`
    - Row ID: current item `drg_deliverableid`
    - `drg_status`: matching overdue status
  - Notify the blocking party and program owner:
    - Action: Office 365 Outlook `Send an email (V2)`, Teams `Post message`, or your selected notification connector

Notes:

- This handles the overall deliverable due date, not the reviewer-specific due date.

## 13. Program Access Revoked

Flow type: Automated cloud flow

Trigger:

- Dataverse: When a row is added, modified, or deleted
- Change type: Modified
- Table name: `drg_programaccesses`
- Scope: Organization
- Select columns: `drg_isactive`
- Filter rows: `statecode eq 0 and drg_isactive eq false`
- Trigger condition:
  - `drg_isactive = No`

Actions:

- Get access row:
  - Action: Dataverse `Get a row by ID`
  - Table name: `drg_programaccesses`
  - Row ID: `drg_programaccess` from the trigger
- Condition: check whether `drg_revokedon` is blank:
  - Action: Control `Condition`
  - Condition: `drg_revokedon` is equal to null
  - If yes:
    - Update access row with revoke timestamp and revoke actor fields.
  - If no:
    - Do nothing.
- Optional: notify program owner that access was revoked:
  - Action: Office 365 Outlook `Send an email (V2)`, Teams `Post message`, or your selected notification connector

## 14. Document Access Log Created

Flow type: Automated cloud flow

Trigger:

- Dataverse: When a row is added, modified, or deleted
- Change type: Added
- Table name: `drg_documentaccesslogs`
- Scope: Organization
- Filter rows: `statecode eq 0`

Actions:

- Get access log row:
  - Action: Dataverse `Get a row by ID`
  - Table name: `drg_documentaccesslogs`
  - Row ID: `drg_documentaccesslog` from the trigger
- Get related document:
  - Action: Dataverse `Get a row by ID`
  - Table name: `drg_documents`
  - Row ID: `_drg_document_value` from the access log row
- Get related program:
  - Action: Dataverse `Get a row by ID`
  - Table name: `drg_programs`
  - Row ID: `_drg_program_value` from the access log row if present, otherwise `_drg_program_value` from the document row
- Condition: if the access log is missing `drg_program`:
  - Action: Control `Condition`
  - Condition: access log program lookup is empty.
  - If yes:
    - Update the access log program lookup from the related document.
  - If no:
    - Do nothing.
- Optional: forward event to reporting/analytics destination:
  - Action: HTTP, Power BI, or your selected reporting connector

Notes:

- This is a general audit/logging helper. The reviewer download flow runs from external reviewer access logs. The reviewer response viewed flow requires internal DRG view/download log rows if DRG chooses to track that event.

## Recommended Build Order

1. `Program Owner Access Sync`
2. `Deliverable Type Normalize`
3. `Program Access Normalize`
4. `DRG Submission Created`
5. `External Reviewer Downloads Submission`
6. `Reviewer Response PDF Uploaded`
7. `Approval Decision Updated`
8. `DRG Acknowledges Signed Approval`
9. `Review Due Date Overdue Check`
10. `Deliverable Due Date Overdue Check`
11. `Program Archive`
12. `Program Access Revoked`
13. `Reviewer Response Viewed By DRG`
14. `Document Access Log Created`

## Implementation Notes

- Prefer Dataverse trigger conditions so flows do not run on unrelated updates.
- Use environment variables for app URLs, SharePoint IDs, and notification sender details. Notifications must link to the app, not directly to SharePoint files.
- Any Power Automate connection that touches SharePoint must use a service account or application-owned connection with access to the controlled library. It must not rely on the end user's SharePoint permissions.
- Do not include `drg_sharepointurl`, SharePoint `webUrl`, or direct document-library links in user-facing emails, Teams posts, or approval notifications.
- Use connection references owned by a service account, not an individual student/user account.
- Use concurrency control carefully on document submission flows so two uploads do not assign the same submission number.
- Keep user-facing validation in the app where possible, and keep Power Automate as backup enforcement for cross-table updates.
