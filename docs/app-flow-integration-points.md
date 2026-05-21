# App and Power Automate Integration Points

Most workflow automation is Dataverse-triggered. The web app should create or update the right rows, then let the configured flows perform rollups, stamping, superseding, and notifications.

| Product action | App write | Flow triggered |
| --- | --- | --- |
| Program creation with owner | Creates `drg_program` with `drg_owneruser` / `drg_ownerupn` | Program Owner Access Sync creates or updates the owner `drg_programaccess` row |
| Program archive | Updates `drg_program.drg_status = Archived` | Program Archive stamps archive fields and hides/rolls up child records as configured |
| Deliverable type creation | Creates `drg_deliverabletype` | Deliverable Type Normalize writes `drg_normalizedname` |
| Program access grant | Creates or reactivates `drg_programaccess` with normalized email, role, active flag, grant metadata, and Entra object ID when available | Program Access Normalize / access-change flows normalize and enforce access history |
| Program access revoke | Updates `drg_programaccess.drg_isactive = false` | Revoke flow stamps revocation metadata |
| DRG submission upload | Uploads PDF to SharePoint and creates `drg_document` with `documentRole = DRG Submission` | DRG Submission Created assigns submission number, supersedes prior submissions, updates deliverable status to Submitted, creates current approval rows, and does not notify reviewers yet |
| Ready for review | Updates `drg_deliverable.drg_status = In Review` after a current DRG submission exists | Deliverable Ready for Review notifies active external reviewers with access to the program |
| Document view/download | Checks Entra role and active `drg_programaccess`, fetches the file through the app's Microsoft Graph SharePoint credential, and streams it back to the browser. The current app creates `drg_documentaccesslog` rows for external reviewer view/download activity, not ordinary internal DRG downloads/views. | Review-start/viewed flows update document/deliverable status and viewed fields for successful logged Web App access events |
| Reviewer response upload | Creates `drg_document` with `documentRole = Reviewer Response` and `drg_parentdocument` set to the DRG submission | Reviewer document flows link response PDFs and update review context |
| Signed approval upload | Creates `drg_document` with `documentRole = Signed Approval` and `drg_parentdocument` set to the DRG submission | Signed approval flows link approval PDF and move work toward acknowledgment |
| Reviewer approval/rejection | Updates `drg_approval.drg_decision`, `drg_comments`, and `drg_responsedocument`; the app also moves the deliverable to `Pending Acknowledgment` or `Returned` immediately | Approval Decision Updated stamps decision date, updates document status, and notifies the program owner for accepted work or the program owner plus DRG staff for returned work |
| DRG acknowledgment of signed approval | Calls the instant `DRG Acknowledges Signed Approval` flow with deliverable ID, accepted submission document ID, and signed approval document ID; the app also moves the deliverable to `Complete` immediately | Acknowledgment flow marks accepted/signed documents final, closes the deliverable as backup enforcement, writes an acknowledgment log, and notifies the owner, DRG staff, and all active external reviewers |
