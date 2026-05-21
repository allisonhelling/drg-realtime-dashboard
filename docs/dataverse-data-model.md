# Dataverse Data Model

This is the implementation-ready Dataverse backbone for the DRG IMS prototype. It turns the current mock TypeScript models into real Dataverse tables, with SharePoint retained as the file store.

Do not manually create Dataverse-generated columns such as table primary key GUIDs, `createdon`, or `modifiedon`. Dataverse creates those automatically.

## Security Model

Entra groups provide broad app-level permissions:

- `drg_admin`: can create programs, manage program access, and assign program owners.
- `drg_program_owner`: can manage access for programs where they are listed as the owner.
- `drg_staff`: can work with assigned programs and can add deliverable types.
- `external_user`: external reviewers who already exist in Entra and can view/upload to programs where they have active program access.

Program-specific access lives in `drg_programaccess`. The Entra group says what a user is allowed to do in general; `drg_programaccess` says which programs they can do it on.

## Global Choices

Create these global choices:

`drg_programstatus`: Draft, Active, On Hold, Closed, Archived

`drg_deliverablestatus`: Draft, Not Submitted, Submitted, In Review, Returned, Pending Acknowledgment, Complete, Overdue - Waiting on Reviewer, Overdue - Waiting on DRG

`drg_accessrole`: Program Owner, DRG Staff, External Reviewer, Read Only

`drg_approvaldecision`: Pending, Approved, Rejected

`drg_documentstatus`: Submitted, Under Review, Returned, Viewed, Outdated, Overdue - Waiting on Reviewer, Reviewed, Final, Archived

`drg_documentrole`: DRG Submission, Reviewer Response, Signed Approval

## Tables

## 1. `drg_program`

Purpose: master record for each contract/program.

Primary name: `drg_name`

Columns:

- `drg_name`: Text, required
- `drg_programnumber`: Text, required, alternate key, unique
- `drg_contractref`: Text, required
- `drg_description`: Multiline text
- `drg_startdate`: Date only
- `drg_enddate`: Date only
- `drg_status`: Choice `drg_programstatus`, required, default Draft
- `drg_creatoruser`: Lookup to `systemuser`
- `drg_creatorupn`: Text, required
- `drg_owneruser`: Lookup to `systemuser`, required
- `drg_ownerupn`: Text, required
- `drg_primarysitecount`: Whole number
- `drg_archivedby`: Lookup to `systemuser`
- `drg_archivedon`: Date and time

Business rules:

- `Validate program dates`: If `drg_startdate` contains data and `drg_enddate` contains data and `drg_enddate < drg_startdate`, show an error message on `drg_enddate`. Dataverse Business Rule. Error display name: `Invalid Program Dates`. Error message: `End date must be on or after the start date.`

- `Restrict program creation`: If user is not in `drg_admin`, do not allow program creation. App/security role rule. Error display name: `Program Creation Restricted`. Error message: `Only DRG admins can create programs.`

- `Require program owner`: If `drg_status = Active` and `drg_owneruser` does not contain data, show an error message on `drg_owneruser`. Dataverse Business Rule. Error display name: `Program Owner Required`. Error message: `Assign a program owner before activating this program.`

- `Create owner access row`: When `drg_owneruser` is set, create or update a matching `drg_programaccess` row with `drg_accessrole = Program Owner`. Power Automate.

- `Archive program`: When an admin sets `drg_status = Archived`, stamp `drg_archivedby` and `drg_archivedon`. Power Automate.

- `Block archived uploads`: If parent program `drg_status = Archived`, block new document uploads while still allowing downloads and analytics. App/Power Automate rule. Error display name: `Program Archived`. Error message: `This program is archived. Documents can still be downloaded, but new uploads are not allowed.`

- `Hide archived records`: If program `drg_status = Archived`, hide the program, deliverables, and documents from default active views. App/view filter.

## 2. `drg_deliverabletype`

Purpose: configurable deliverable type list. Seed with `CDRL` and `SDRL`, but allow DRG staff to add custom types from the app.

Primary name: `drg_name`

Columns:

- `drg_name`: Text, required
- `drg_normalizedname`: Text, required, alternate key, unique
- `drg_isactive`: Yes/No, required, default Yes
- `drg_createdbyuser`: Lookup to `systemuser`

Business rules:

- `Seed default types`: Create initial rows for `CDRL` and `SDRL`. Data setup.
- `Normalize type name`: When `drg_name` is entered or changed, set `drg_normalizedname = lower(trim(drg_name))`. App/Power Automate rule.
- `Prevent duplicate types`: If another row has the same `drg_normalizedname`, block save through the `drg_normalizedname` alternate key. Dataverse alternate key. Error display name: `Duplicate Deliverable Type`. Error message: `A deliverable type with this name already exists. Select the existing type or enter a different name.`
- `Suggest existing types`: As staff type `drg_name`, search active `drg_deliverabletype` rows by name and show suggestions. App rule.
- `Restrict type creation`: If user is not in `drg_staff` or `drg_admin`, do not allow deliverable type creation. App/security role rule. Error display name: `Deliverable Type Creation Restricted`. Error message: `Only DRG staff and DRG admins can add new deliverable types.`

## 3. `drg_deliverable`

Purpose: contractual submission requirement for a program.

Primary name: `drg_title`

Columns:

- `drg_title`: Text, required
- `drg_deliverablenumber`: Text, required
- `drg_program`: Lookup to `drg_program`, required
- `drg_contractref`: Text, required
- `drg_type`: Lookup to `drg_deliverabletype`, required
- `drg_description`: Multiline text
- `drg_duedate`: Date and time, required
- `drg_assignedtouser`: Lookup to `systemuser`
- `drg_assignedtoemail`: Text
- `drg_status`: Choice `drg_deliverablestatus`, required, default Not Submitted
- `drg_lastsubmittedon`: Date and time
- `drg_lastapprovedon`: Date and time
- `drg_acknowledgedby`: Lookup to `systemuser`
- `drg_acknowledgedbyemail`: Text
- `drg_acknowledgedon`: Date and time
- `drg_currentsubmissionnumber`: Whole number
- `drg_isclosed`: Yes/No, required, default No

Create one composite alternate key:

- Key name: `ak_deliverable_program_number`
- Columns in the same key: `drg_program`, `drg_deliverablenumber`

Business rules:

- `Default new deliverable`: When a deliverable is created, set `drg_status = Not Submitted` and `drg_isclosed = No`. Dataverse default values.
- `Staff-created deliverable draft`: When DRG staff create a deliverable, set `drg_status = Draft`. Program owners or DRG admins approve the draft by setting `drg_status = Not Submitted`.
- `Copy contract reference`: When `drg_program` is selected, set `drg_contractref` from the parent program contract reference. App/Power Automate rule.
- `Submit deliverable`: When DRG staff upload a current `DRG Submission` document, set `drg_status = Submitted`, increment `drg_currentsubmissionnumber`, stamp `drg_lastsubmittedon`, and notify external reviewer(s). Power Automate.
- `Start review`: When an external reviewer downloads the current `DRG Submission` document, set `drg_status = In Review`. Power Automate.
- `Return deliverable`: When current approval `drg_decision = Rejected`, set `drg_status = Returned`. Power Automate.
- `Pending acknowledgment`: When current approval `drg_decision = Approved` and a signed approval PDF exists, set `drg_status = Pending Acknowledgment` and stamp `drg_lastapprovedon`. Power Automate.
- `Complete deliverable`: When DRG staff acknowledge the signed approval PDF, set `drg_status = Complete`, `drg_isclosed = Yes`, and stamp the acknowledgment fields. Power Automate.
- `Deliverable overdue`: If current date/time is after `drg_duedate` and `drg_status != Complete`, set status to `Overdue - Waiting on Reviewer` or `Overdue - Waiting on DRG` based on the current blocking party. Scheduled Power Automate.
- `Allow custom type`: If no matching active deliverable type exists and user is in `drg_staff` or `drg_admin`, allow creation of a new `drg_deliverabletype` row from the type picker. App rule.

## 4. `drg_programaccess`

Purpose: explicit permission row connecting a person to a program.

Primary name: `drg_name`

Columns:

- `drg_name`: Text, required
- `drg_program`: Lookup to `drg_program`, required
- `drg_user`: Lookup to `systemuser`, required
- `drg_email`: Text, required
- `drg_accessrole`: Choice `drg_accessrole`, required
- `drg_isactive`: Yes/No, required, default Yes
- `drg_grantedon`: Date and time, required
- `drg_grantedby`: Lookup to `systemuser`
- `drg_grantedbyemail`: Text, required
- `drg_revokedon`: Date and time
- `drg_revokedby`: Lookup to `systemuser`
- `drg_revokedbyemail`: Text
- `drg_entraobjectid`: Text

Create one composite alternate key:

- Key name: `ak_programaccess_program_email`
- Columns in the same key: `drg_program`, `drg_email`

Business rules:

- `Normalize access email`: When `drg_email` is entered or changed, set `drg_email = lower(trim(drg_email))`. App/Power Automate rule.
- `Prevent duplicate program access`: If another row has the same `drg_program` and `drg_email`, block save through the alternate key. Dataverse alternate key. Error display name: `Duplicate Program Access`. Error message: `This user already has access to this program.`
- `Deactivate access`: When access is revoked, set `drg_isactive = No` and stamp `drg_revokedon`, `drg_revokedby`, and `drg_revokedbyemail`. Power Automate.
- `Restrict access grants`: If user is not a program owner for that program and not in `drg_admin`, do not allow creating program access rows. App/security role rule. Error display name: `Access Grant Restricted`. Error message: `Only the program owner or a DRG admin can add users to this program.`
- `External reviewer prerequisite`: Before adding an external reviewer to `drg_programaccess`, DRG must add the user to the tenant and assign them to `external_user`. Admin process/security rule. Error display name: `External User Not Ready`. Error message: `This external user must already exist in Entra and belong to the external_user group before they can be added to a program.`

## 5. `drg_document`

Purpose: business metadata for a PDF whose binary lives in SharePoint.

Primary name: `drg_name`

Columns:

- `drg_name`: Text, required
- `drg_program`: Lookup to `drg_program`, required
- `drg_deliverable`: Lookup to `drg_deliverable`, required
- `drg_submissionnumber`: Whole number, required
- `drg_documentrole`: Choice `drg_documentrole`, required
- `drg_parentdocument`: Lookup to `drg_document`
- `drg_approval`: Optional lookup to `drg_approval`. Add this after both `drg_document` and `drg_approval` exist; it links reviewer response/signed approval documents back to the approval row that produced them.
- `drg_filename`: Text, required
- `drg_description`: Multiline text
- `drg_filesizekb`: Whole number
- `drg_sharepointsiteurl`: URL, optional/admin metadata
- `drg_sharepointdriveid`: Text, required
- `drg_sharepointitemid`: Text, required
- `drg_sharepointurl`: URL, optional/admin metadata. User downloads must not redirect to this URL.
- `drg_versionlabel`: Text
- `drg_status`: Choice `drg_documentstatus`, required, default Submitted
- `drg_reviewduedate`: Date and time
- `drg_uploadedby`: Lookup to `systemuser`
- `drg_uploadedbyemail`: Text, required
- `drg_uploadedon`: Date and time, required
- `drg_viewedby`: Lookup to `systemuser`
- `drg_viewedbyemail`: Text
- `drg_viewedon`: Date and time
- `drg_supersededbydocument`: Lookup to `drg_document`
- `drg_supersededon`: Date and time
- `drg_checksum`: Text
- `drg_iscurrentversion`: Yes/No, required, default Yes

Create one composite alternate key:

- Key name: `ak_document_sharepoint_item`
- Columns in the same key: `drg_sharepointdriveid`, `drg_sharepointitemid`

Business rules:

- `Require PDF`: If uploaded file extension is not `.pdf` or MIME type is not `application/pdf`, block document creation. App/Power Automate rule. Error display name: `PDF Required`. Error message: `Only PDF files can be uploaded.`
- `Default document status`: When a document row is created, set `drg_status = Submitted` and `drg_iscurrentversion = Yes`. Dataverse default values.
- `Set DRG submission role`: If uploader is DRG staff and the PDF is being sent for external review, set `drg_documentrole = DRG Submission`. App rule.
- `Set reviewer response role`: If external reviewer uploads an optional response PDF for a rejected submission, set `drg_documentrole = Reviewer Response`. App rule.
- `Set signed approval role`: If external reviewer uploads the approved signed PDF, set `drg_documentrole = Signed Approval`. App rule.
- `Link reviewer document`: If `drg_documentrole = Reviewer Response` or `Signed Approval`, require `drg_parentdocument` to contain the DRG submission being reviewed. Dataverse Business Rule or app rule. Error display name: `Reviewed Document Required`. Error message: `Select the DRG submission this reviewer document belongs to.`
- `Set review due date`: If DRG staff enter `drg_reviewduedate`, copy the same date to the related `drg_approval.drg_duedate`. Power Automate.
- `Supersede prior submission`: When DRG staff upload a new `DRG Submission` before the deliverable is complete, set the previous current DRG submission to `Outdated`, set `drg_iscurrentversion = No`, and stamp superseded fields. Power Automate.
- `Assign submission number`: When DRG staff upload a `DRG Submission`, set `drg_submissionnumber = previous current submission number + 1`. Power Automate.
- `Maintain current submission`: When a new current `DRG Submission` is created, ensure all other DRG submissions for that deliverable have `drg_iscurrentversion = No`. Power Automate.
- `Start document review`: When an external reviewer downloads the current `DRG Submission`, set `drg_status = Under Review` and stamp viewed fields. Power Automate.
- `Return document`: When related current approval `drg_decision = Rejected`, set the DRG submission document status to `Returned`. Power Automate.
- `Mark reviewer response viewed`: When DRG staff download a `Reviewer Response` document, set that document status to `Viewed` and stamp viewed fields. Power Automate.
- `Mark reviewed`: When related current approval `drg_decision = Approved` and a signed approval PDF exists, set the DRG submission document status to `Reviewed`. Power Automate.
- `Mark final`: When DRG staff acknowledge the signed approval PDF, set the accepted DRG submission document status to `Final`. Power Automate.
- `Document overdue`: If current date/time is after `drg_reviewduedate` and the related approval is still `Pending`, set current DRG submission status to `Overdue - Waiting on Reviewer`. Scheduled Power Automate.
- `Controlled file access`: End users must not be redirected to `drg_sharepointurl`. All user downloads must go through the web app download API. The app checks Entra role and active `drg_programaccess`, creates a `drg_documentaccesslog` row, retrieves the file from SharePoint using Microsoft Graph app credentials, and streams the file response to the user.
- `SharePoint uniqueness`: If another row has the same `drg_sharepointdriveid` and `drg_sharepointitemid`, block save through the alternate key. Dataverse alternate key. Error display name: `Duplicate SharePoint Document`. Error message: `This SharePoint file is already linked to a document record.`

## 6. `drg_approval`

Purpose: approval workflow history for a deliverable submission.

Primary name: `drg_name`

Columns:

- `drg_name`: Text, required
- `drg_program`: Lookup to `drg_program`, required
- `drg_deliverable`: Lookup to `drg_deliverable`, required
- `drg_document`: Lookup to `drg_document`, required
- `drg_submissionnumber`: Whole number, required
- `drg_revieweruser`: Lookup to `systemuser`
- `drg_revieweremail`: Text, required
- `drg_decision`: Choice `drg_approvaldecision`, required, default Pending
- `drg_comments`: Multiline text
- `drg_responsedocument`: Lookup to `drg_document`
- `drg_duedate`: Date and time
- `drg_decisiondate`: Date and time
- `drg_iscurrent`: Yes/No, required, default Yes

Business rules:

- `Create approval requests`: When a DRG submission is created, create one `drg_approval` row per external reviewer assigned to the program/deliverable. Power Automate.
- `Default approval decision`: When an approval row is created, set `drg_decision = Pending` and `drg_iscurrent = Yes`. Dataverse default values.
- `Restrict reviewer access`: If reviewer does not have active `drg_programaccess` for the program, do not allow review/download/upload actions. App/security role rule. Error display name: `Reviewer Access Required`. Error message: `You do not have active reviewer access for this program.`
- `Require rejection comments`: If `drg_decision = Rejected` and `drg_comments` does not contain data, show an error message on `drg_comments`. Dataverse Business Rule. Error display name: `Rejection Reason Required`. Error message: `Enter a reason before rejecting this submission.`
- `Allow rejection response PDF`: If `drg_decision = Rejected`, allow but do not require `drg_responsedocument` with role `Reviewer Response`. App rule.
- `Require signed approval PDF`: If `drg_decision = Approved` and `drg_responsedocument` does not contain a document with role `Signed Approval`, block save or approval submission. App/Power Automate rule. Error display name: `Signed PDF Required`. Error message: `Upload the signed approval PDF before approving this submission.`
- `Stamp decision date`: When `drg_decision` changes from `Pending` to `Approved` or `Rejected`, set `drg_decisiondate` to the current date/time. Power Automate.
- `Close older approval rows`: When a new DRG submission is uploaded, set older active approval rows for that deliverable to `drg_iscurrent = No`. Power Automate.
- `Roll up statuses`: When approval decision changes, update related `drg_deliverable.drg_status` and `drg_document.drg_status`. Power Automate.
- `Approval overdue`: If current date/time is after `drg_duedate` and `drg_decision = Pending`, mark the current document and deliverable as overdue waiting on reviewer. Scheduled Power Automate.

## 7. `drg_programsite`

Purpose: normalized list of sites for each program.

Primary name: `drg_name`

Columns:

- `drg_program`: Lookup to `drg_program`, required
- `drg_name`: Text, required
- `drg_sitecode`: Text
- `drg_region`: Text
- `drg_isprimary`: Yes/No, required, default No

## 8. `drg_documentaccesslog`

Purpose: persistent audit rows for view/download/upload events.

Primary name: `drg_name`

Columns:

- `drg_name`: Text, required
- `drg_document`: Lookup to `drg_document`, required
- `drg_program`: Lookup to `drg_program`, required
- `drg_actoruser`: Lookup to `systemuser`
- `drg_actorname`: Text, required
- `drg_actoremail`: Text, required
- `drg_action`: Choice with values View, Download, Upload, Delete, Acknowledge, required
- `drg_occurredon`: Date and time, required
- `drg_result`: Choice with values Success, Denied, Failed
- `drg_requestid`: Text

Business rules:

- `Successful access events`: Status rollup flows should only treat `drg_action = View` or `Download` as a real view/download when, if `drg_result` is used, `drg_result = Success`. Denied or failed access attempts may be retained for audit history but must not move documents or deliverables into review states.

## Relationships

Create these relationships:

- `drg_program` 1-to-many `drg_deliverable`
- `drg_program` 1-to-many `drg_programaccess`
- `drg_program` 1-to-many `drg_document`
- `drg_program` 1-to-many `drg_approval`
- `drg_program` 1-to-many `drg_programsite`
- `drg_deliverabletype` 1-to-many `drg_deliverable`
- `drg_deliverable` 1-to-many `drg_document`
- `drg_deliverable` 1-to-many `drg_approval`
- `drg_document` 1-to-many `drg_document` through `drg_parentdocument`
- `drg_document` 1-to-many `drg_approval`
- `drg_approval` 1-to-many `drg_document` through `drg_approval`
- `drg_document` 1-to-many `drg_approval` through `drg_responsedocument`
- `drg_document` 1-to-many `drg_documentaccesslog`

Parent delete should be restricted for `drg_program` and `drg_deliverable` child records. Use status fields or active flags to retire records instead of deleting history.

## Build Order

1. Create global choices.
2. Create `drg_program`.
3. Create `drg_deliverabletype` and seed `CDRL` and `SDRL`.
4. Create `drg_deliverable`.
5. Create `drg_programaccess`.
6. Create `drg_document` without the optional `drg_approval` lookup.
7. Create `drg_approval`.
8. Add the optional `drg_document.drg_approval` lookup after both tables exist.
9. Create `drg_programsite`.
10. Create `drg_documentaccesslog`.
11. Add alternate keys.
12. Add business rules and required columns.
13. Enable auditing on all tables.
