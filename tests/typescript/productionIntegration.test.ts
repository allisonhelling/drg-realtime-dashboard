import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Approval } from "@/lib/models/approval";
import type { Program } from "@/lib/models/program";

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));

const DATAVERSE_URL = "https://org.crm.dynamics.com";
const FORMATTED_VALUE_ANNOTATION =
  "OData.Community.Display.V1.FormattedValue";

function configureDataverseEnv() {
  vi.stubEnv("DATAVERSE_URL", DATAVERSE_URL);
  vi.stubEnv("DATAVERSE_TENANT_ID", "tenant-id");
  vi.stubEnv("DATAVERSE_CLIENT_ID", "client-id");
  vi.stubEnv("DATAVERSE_CLIENT_SECRET", "client-secret");
}

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    statusText: init?.statusText,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
}

function createDataverseFetchMock(
  handlers: Record<string, (request: Request) => Response | Promise<Response>>
) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = request.url;

    if (url.includes("login.microsoftonline.com")) {
      return jsonResponse({ access_token: "dataverse-token" });
    }

    const match = Object.entries(handlers).find(([key]) => url.includes(key));
    if (!match) {
      throw new Error(`Unhandled fetch URL: ${url}`);
    }

    return match[1](request);
  });
}

function createProgram(input: Partial<Program> = {}): Program {
  return {
    id: "program-1",
    name: "Surface Comms",
    programNumber: "PRG-001",
    contractRef: "W912-001",
    description: "",
    sites: [],
    status: "Active",
    startDate: "",
    endDate: "",
    creatorUpn: "owner@drg.test",
    ownerUpn: "owner@drg.test",
    primarySiteCount: 0,
    createdAt: "",
    access: [],
    ...input,
  };
}

function createApproval(input: Partial<Approval> = {}): Approval {
  return {
    id: "approval-1",
    name: "Review CDRL-001",
    programId: "program-1",
    deliverableId: "deliverable-1",
    documentId: "document-1",
    submissionNumber: 1,
    reviewerEmail: "reviewer@gov.test",
    decision: "Pending",
    isCurrent: true,
    ...input,
  };
}

describe("production integration layer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("treats blank Dataverse env aliases as unset", async () => {
    vi.resetModules();
    vi.stubEnv("DATAVERSE_URL", "");
    vi.stubEnv("DATAVERSE_ENVIRONMENT_URL", DATAVERSE_URL);
    vi.stubEnv("DATAVERSE_TENANT_ID", "tenant-id");
    vi.stubEnv("DATAVERSE_CLIENT_ID", "client-id");
    vi.stubEnv("DATAVERSE_CLIENT_SECRET", "client-secret");
    vi.stubEnv("DATAVERSE_SCOPE", "");
    vi.stubEnv("DATAVERSE_RESOURCE", "");

    let tokenRequestBody = "";
    global.fetch = createDataverseFetchMock({
      "/WhoAmI": () => jsonResponse({ UserId: "user-1" }),
    });
    vi.mocked(global.fetch).mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        if (request.url.includes("login.microsoftonline.com")) {
          tokenRequestBody = await request.text();
          return jsonResponse({ access_token: "dataverse-token" });
        }

        return jsonResponse({ UserId: "user-1" });
      }
    );

    const { dataverseFetch, getDataverseApiUrl, isDataverseConfigured } =
      await import("@/lib/dataverse/client");

    expect(isDataverseConfigured()).toBe(true);
    expect(getDataverseApiUrl("/WhoAmI")).toBe(
      `${DATAVERSE_URL}/api/data/v9.2/WhoAmI`
    );

    await dataverseFetch("/WhoAmI");

    expect(new URLSearchParams(tokenRequestBody).get("scope")).toBe(
      `${DATAVERSE_URL}/.default`
    );
  });

  it("maps Dataverse choice labels and lookup IDs for documents", async () => {
    vi.resetModules();
    configureDataverseEnv();
    global.fetch = createDataverseFetchMock({
      "/drg_documents?": () =>
        jsonResponse({
          value: [
            {
              drg_documentid: "document-1",
              drg_name: "Reviewed response",
              drg_filename: "response.docx",
              drg_filesizekb: 42,
              drg_submissionnumber: 2,
              drg_uploadedbyemail: "reviewer@gov.test",
              drg_uploadedon: "2026-04-01T12:00:00Z",
              _drg_uploadedby_value: "user-1",
              _drg_deliverable_value: "deliverable-1",
              _drg_program_value: "program-1",
              _drg_parentdocument_value: "submission-1",
              _drg_approval_value: "approval-1",
              drg_sharepointsiteurl: "https://sharepoint.test/sites/drg",
              drg_sharepointdriveid: "drive-1",
              drg_sharepointitemid: "item-1",
              drg_sharepointurl: "https://sharepoint.test/file",
              drg_versionlabel: "v2",
              drg_reviewduedate: "2026-04-15",
              _drg_viewedby_value: "viewer-1",
              drg_viewedbyemail: "staff@drg.test",
              drg_viewedon: "2026-04-02T12:00:00Z",
              drg_checksum: "abc123",
              drg_iscurrentversion: true,
              [`drg_documentrole@${FORMATTED_VALUE_ANNOTATION}`]:
                "Reviewer Response",
              [`drg_status@${FORMATTED_VALUE_ANNOTATION}`]: "Reviewed",
            },
          ],
        }),
    });

    const { listDocuments } = await import("@/lib/dataverse/documents");

    await expect(listDocuments()).resolves.toMatchObject([
      {
        id: "document-1",
        fileType: "Word",
        deliverableId: "deliverable-1",
        programId: "program-1",
        documentRole: "Reviewer Response",
        parentDocumentId: "submission-1",
        approvalId: "approval-1",
        status: "Reviewed",
      },
    ]);
  });

  it("filters visible programs by internal role and active program access", async () => {
    vi.resetModules();
    configureDataverseEnv();
    global.fetch = createDataverseFetchMock({
      "/drg_programs?": () =>
        jsonResponse({
          value: [
            {
              drg_programid: "program-1",
              drg_name: "Visible Program",
              drg_programnumber: "PRG-001",
              drg_contractref: "W912-001",
              _drg_owneruser_value: "owner-user-1",
              [`_drg_owneruser_value@${FORMATTED_VALUE_ANNOTATION}`]:
                "Pat Program Owner",
              [`drg_status@${FORMATTED_VALUE_ANNOTATION}`]: "Active",
            },
            {
              drg_programid: "program-2",
              drg_name: "Hidden Program",
              drg_programnumber: "PRG-002",
              drg_contractref: "W912-002",
              [`drg_status@${FORMATTED_VALUE_ANNOTATION}`]: "Active",
            },
            {
              drg_programid: "program-3",
              drg_name: "Archived Program",
              drg_programnumber: "PRG-003",
              drg_contractref: "W912-003",
              [`drg_status@${FORMATTED_VALUE_ANNOTATION}`]: "Archived",
            },
          ],
        }),
      "/drg_programsites?": () => jsonResponse({ value: [] }),
      "/drg_programaccesses?": () =>
        jsonResponse({
          value: [
            {
              drg_programaccessid: "access-1",
              drg_email: "reviewer@gov.test",
              drg_isactive: true,
              _drg_program_value: "program-1",
              _drg_user_value: "reviewer-user-1",
              [`_drg_user_value@${FORMATTED_VALUE_ANNOTATION}`]:
                "Riley Reviewer",
              [`drg_accessrole@${FORMATTED_VALUE_ANNOTATION}`]:
                "External Reviewer",
            },
            {
              drg_programaccessid: "access-2",
              drg_email: "reviewer@gov.test",
              drg_isactive: false,
              _drg_program_value: "program-2",
              [`drg_accessrole@${FORMATTED_VALUE_ANNOTATION}`]:
                "External Reviewer",
            },
            {
              drg_programaccessid: "access-3",
              drg_email: "reviewer@gov.test",
              drg_isactive: true,
              _drg_program_value: "program-3",
              [`drg_accessrole@${FORMATTED_VALUE_ANNOTATION}`]:
                "External Reviewer",
            },
          ],
        }),
    });

    const { listVisiblePrograms } = await import("@/lib/dataverse/programs");

    const reviewerPrograms = await listVisiblePrograms({
      email: "reviewer@gov.test",
      internalRoles: ["external-reviewer"],
    });
    const adminPrograms = await listVisiblePrograms({
      email: "admin@drg.test",
      internalRoles: ["drg-admin"],
    });

    expect(reviewerPrograms.map((program) => program.id)).toEqual(["program-1"]);
    expect(reviewerPrograms[0].ownerName).toBe("Pat Program Owner");
    expect(reviewerPrograms[0].access[0].displayName).toBe("Riley Reviewer");
    expect(adminPrograms.map((program) => program.id)).toEqual([
      "program-1",
      "program-2",
    ]);
  });

  it("writes Dataverse program access choice values as integers", async () => {
    vi.resetModules();
    configureDataverseEnv();

    let createdPayload: Record<string, unknown> | undefined;
    global.fetch = createDataverseFetchMock({
      "/drg_programaccesses?": () => jsonResponse({ value: [] }),
      "/EntityDefinitions(LogicalName='drg_programaccess')/Attributes(LogicalName='drg_accessrole')": () =>
        jsonResponse({
          OptionSet: {
            Options: [
              {
                Value: 799960000,
                Label: { UserLocalizedLabel: { Label: "Program Owner" } },
              },
              {
                Value: 799960001,
                Label: { UserLocalizedLabel: { Label: "DRG Staff" } },
              },
              {
                Value: 799960002,
                Label: { UserLocalizedLabel: { Label: "External Reviewer" } },
              },
              {
                Value: 799960003,
                Label: { UserLocalizedLabel: { Label: "Read Only" } },
              },
            ],
          },
        }),
      "/drg_programaccesses": async (request) => {
        createdPayload = (await request.json()) as Record<string, unknown>;
        return jsonResponse({}, { status: 201 });
      },
    });

    const { createProgramAccess } = await import(
      "@/lib/dataverse/program-access"
    );

    await createProgramAccess({
      programId: "program-1",
      programNumber: "PRG-001",
      email: "staff@drg.test",
      grantedByEmail: "admin@drg.test",
      accessRole: "DRG Staff",
    });

    expect(createdPayload).toMatchObject({
      drg_name: "PRG-001 | staff@drg.test",
      "drg_program@odata.bind": "/drg_programs(program-1)",
      drg_email: "staff@drg.test",
      drg_accessrole: 799960001,
      drg_isactive: true,
      drg_grantedbyemail: "admin@drg.test",
    });
  });

  it("blocks deleting programs with substantive child records", async () => {
    vi.resetModules();
    configureDataverseEnv();

    global.fetch = createDataverseFetchMock({
      "/drg_deliverables?": () =>
        jsonResponse({ value: [{ drg_deliverableid: "deliverable-1" }] }),
      "/drg_documents?": () => jsonResponse({ value: [] }),
      "/drg_approvals?": () => jsonResponse({ value: [] }),
      "/drg_documentaccesslogs?": () => jsonResponse({ value: [] }),
    });

    const { deleteEmptyProgram } = await import("@/lib/dataverse/programs");

    await expect(deleteEmptyProgram("program-1")).rejects.toMatchObject({
      code: "programDeleteBlocked",
      status: 409,
    });

    expect(global.fetch).not.toHaveBeenCalledWith(
      expect.stringContaining("/drg_programs(program-1)"),
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("deletes setup children before deleting empty test programs", async () => {
    vi.resetModules();
    configureDataverseEnv();

    const deletedPaths: string[] = [];
    global.fetch = createDataverseFetchMock({
      "/drg_deliverables?": () => jsonResponse({ value: [] }),
      "/drg_documents?": () => jsonResponse({ value: [] }),
      "/drg_approvals?": () => jsonResponse({ value: [] }),
      "/drg_documentaccesslogs?": () => jsonResponse({ value: [] }),
      "/drg_programsites?": () =>
        jsonResponse({ value: [{ drg_programsiteid: "site-1" }] }),
      "/drg_programaccesses?": () =>
        jsonResponse({ value: [{ drg_programaccessid: "access-1" }] }),
      "/drg_programsites(site-1)": (request) => {
        deletedPaths.push(new URL(request.url).pathname);
        return new Response(null, { status: 204 });
      },
      "/drg_programaccesses(access-1)": (request) => {
        deletedPaths.push(new URL(request.url).pathname);
        return new Response(null, { status: 204 });
      },
      "/drg_programs(program-1)": (request) => {
        deletedPaths.push(new URL(request.url).pathname);
        return new Response(null, { status: 204 });
      },
    });

    const { deleteEmptyProgram } = await import("@/lib/dataverse/programs");

    await expect(deleteEmptyProgram("program-1")).resolves.toBeUndefined();
    expect(deletedPaths).toEqual([
      "/api/data/v9.2/drg_programsites(site-1)",
      "/api/data/v9.2/drg_programaccesses(access-1)",
      "/api/data/v9.2/drg_programs(program-1)",
    ]);
  });

  it("updates program information and replaces site rows", async () => {
    vi.resetModules();
    configureDataverseEnv();

    let programPayload: Record<string, unknown> | undefined;
    const createdSites: Record<string, unknown>[] = [];
    const deletedPaths: string[] = [];

    global.fetch = createDataverseFetchMock({
      "/systemusers?": () =>
        jsonResponse({ value: [{ systemuserid: "owner-user-1" }] }),
      "/drg_programs(program-1)": async (request) => {
        programPayload = await request.json();
        return new Response(null, { status: 204 });
      },
      "/drg_programsites?": () =>
        jsonResponse({
          value: [
            { drg_programsiteid: "site-1" },
            { drg_programsiteid: "site-2" },
          ],
        }),
      "/drg_programsites(site-1)": (request) => {
        deletedPaths.push(new URL(request.url).pathname);
        return new Response(null, { status: 204 });
      },
      "/drg_programsites(site-2)": (request) => {
        deletedPaths.push(new URL(request.url).pathname);
        return new Response(null, { status: 204 });
      },
      "/drg_programsites": async (request) => {
        createdSites.push(await request.json());
        return jsonResponse({ drg_programsiteid: `site-${createdSites.length + 2}` }, { status: 201 });
      },
    });

    const { updateProgram } = await import("@/lib/dataverse/programs");

    await updateProgram({
      programId: "program-1",
      name: "Logistics Modernization Pilot",
      programNumber: "PRG-009",
      contractRef: "W912-009",
      description: "Updated program",
      sites: ["Norfolk, VA", "Tinker AFB, OK"],
      startDate: "2026-05-01",
      endDate: "2026-12-31",
      ownerUpn: "owner@drg.test",
    });

    expect(programPayload).toMatchObject({
      drg_name: "Logistics Modernization Pilot",
      drg_programnumber: "PRG-009",
      drg_contractref: "W912-009",
      drg_description: "Updated program",
      drg_startdate: "2026-05-01",
      drg_enddate: "2026-12-31",
      drg_ownerupn: "owner@drg.test",
      "drg_owneruser@odata.bind": "/systemusers(owner-user-1)",
      drg_primarysitecount: 2,
    });
    expect(deletedPaths).toEqual([
      "/api/data/v9.2/drg_programsites(site-1)",
      "/api/data/v9.2/drg_programsites(site-2)",
    ]);
    expect(createdSites).toEqual([
      {
        drg_name: "Norfolk, VA",
        "drg_program@odata.bind": "/drg_programs(program-1)",
        drg_isprimary: true,
      },
      {
        drg_name: "Tinker AFB, OK",
        "drg_program@odata.bind": "/drg_programs(program-1)",
        drg_isprimary: false,
      },
    ]);
  });

  it("blocks non-PDF uploads before SharePoint is called", async () => {
    vi.resetModules();
    vi.stubEnv("SHAREPOINT_TENANT_ID", "tenant-id");
    vi.stubEnv("SHAREPOINT_CLIENT_ID", "client-id");
    vi.stubEnv("SHAREPOINT_CLIENT_SECRET", "client-secret");
    vi.stubEnv("SHAREPOINT_SITE_ID", "site-id");
    vi.stubEnv("SHAREPOINT_DRIVE_ID", "drive-id");
    global.fetch = vi.fn();

    const { uploadPdfToSharePoint } = await import("@/lib/sharepoint/files");

    await expect(
      uploadPdfToSharePoint({
        programId: "program-1",
        deliverableId: "deliverable-1",
        fileName: "submission.docx",
        content: new ArrayBuffer(0),
      })
    ).rejects.toMatchObject({ code: "pdfRequired" });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("fetches SharePoint files through Graph app credentials", async () => {
    vi.resetModules();
    vi.stubEnv("SHAREPOINT_TENANT_ID", "tenant-id");
    vi.stubEnv("SHAREPOINT_CLIENT_ID", "client-id");
    vi.stubEnv("SHAREPOINT_CLIENT_SECRET", "client-secret");
    vi.stubEnv("SHAREPOINT_SITE_ID", "site-id");
    vi.stubEnv("SHAREPOINT_DRIVE_ID", "drive-id");

    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);

      if (request.url.includes("login.microsoftonline.com")) {
        return jsonResponse({ access_token: "graph-token" });
      }

      if (request.url.includes("/drives/drive-id/items/item-id/content")) {
        expect(request.headers.get("authorization")).toBe("Bearer graph-token");
        return new Response("pdf-bytes", {
          headers: {
            "content-type": "application/pdf",
            "content-length": "9",
          },
        });
      }

      throw new Error(`Unhandled fetch URL: ${request.url}`);
    });

    const { fetchSharePointFile } = await import("@/lib/sharepoint/files");
    const response = await fetchSharePointFile({
      driveId: "drive-id",
      itemId: "item-id",
    });

    await expect(response.text()).resolves.toBe("pdf-bytes");
    expect(response.headers.get("content-type")).toBe("application/pdf");
  });

  it("creates document metadata with Dataverse integer choice values", async () => {
    vi.resetModules();
    configureDataverseEnv();

    let createdPayload: Record<string, unknown> | undefined;
    global.fetch = createDataverseFetchMock({
      "/systemusers?": () =>
        jsonResponse({
          value: [{ systemuserid: "uploader-user-1" }],
        }),
      "Attributes(LogicalName='drg_documentrole')": () =>
        jsonResponse({
          GlobalOptionSet: {
            Options: [
              {
                Value: 100000000,
                Label: { UserLocalizedLabel: { Label: "DRG Submission" } },
              },
              {
                Value: 100000001,
                Label: { UserLocalizedLabel: { Label: "Reviewer Response" } },
              },
            ],
          },
        }),
      "Attributes(LogicalName='drg_status')": () =>
        jsonResponse({
          GlobalOptionSet: {
            Options: [
              {
                Value: 100000010,
                Label: { UserLocalizedLabel: { Label: "Submitted" } },
              },
            ],
          },
        }),
      "/drg_documents": async (request) => {
        createdPayload = await request.json();
        return jsonResponse({ drg_documentid: "document-1" }, { status: 201 });
      },
    });

    const { createDocumentMetadata } = await import("@/lib/dataverse/documents");
    await expect(
      createDocumentMetadata({
        programId: "program-1",
        deliverableId: "deliverable-1",
        fileName: "submission.pdf",
        sizeKb: 12,
        uploadedByEmail: "staff@drg.test",
        description: "Reviewer context for this submission.",
        sharePointSiteUrl: "https://sharepoint.test/sites/drg",
        sharePointDriveId: "drive-id",
        sharePointItemId: "item-id",
        sharePointUrl: `https://sharepoint.test/sites/drg/Shared%20Documents/${"nested-folder/".repeat(8)}submission.pdf`,
        documentRole: "DRG Submission",
      })
    ).resolves.toBe("document-1");

    expect(createdPayload).toMatchObject({
      drg_documentrole: 100000000,
      drg_status: 100000010,
      drg_description: "Reviewer context for this submission.",
      drg_sharepointsiteurl: "https://sharepoint.test/sites/drg",
      "drg_uploadedby@odata.bind": "/systemusers(uploader-user-1)",
    });
    expect(createdPayload?.drg_sharepointurl).toBeUndefined();
  });

  it("creates readable SharePoint folders before uploading PDFs", async () => {
    vi.resetModules();
    vi.stubEnv("SHAREPOINT_TENANT_ID", "tenant-id");
    vi.stubEnv("SHAREPOINT_CLIENT_ID", "client-id");
    vi.stubEnv("SHAREPOINT_CLIENT_SECRET", "client-secret");
    vi.stubEnv("SHAREPOINT_SITE_ID", "site-id");
    vi.stubEnv("SHAREPOINT_SITE_URL", "https://sharepoint.test/sites/drg");
    vi.stubEnv("SHAREPOINT_DRIVE_ID", "drive-id");
    vi.stubEnv("SHAREPOINT_DOCUMENT_FOLDER", "DRG Submissions");
    vi.stubEnv("SHAREPOINT_FOLDER_STRATEGY", "program-deliverable");

    const folderLookups = new Set<string>();
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const url = request.url;

      if (url.includes("login.microsoftonline.com")) {
        return jsonResponse({ access_token: "graph-token" });
      }

      if (request.method === "GET" && url.includes("/root:/")) {
        folderLookups.add(decodeURIComponent(url.split("/root:/")[1] ?? ""));
        return new Response(null, { status: 404 });
      }

      if (request.method === "POST" && url.includes("/children")) {
        return jsonResponse({ id: "folder-id" }, { status: 201 });
      }

      if (request.method === "PUT" && url.includes(":/content")) {
        return jsonResponse(
          {
            id: "item-id",
            webUrl:
              "https://sharepoint.test/sites/drg/DRG%20Submissions/program/deliverable/file.pdf",
            size: 2048,
            parentReference: {
              driveId: "drive-id",
              siteId: "site-id",
            },
          },
          { status: 201 }
        );
      }

      throw new Error(`Unhandled fetch URL: ${url}`);
    });

    const { uploadPdfToSharePoint } = await import("@/lib/sharepoint/files");

    await expect(
      uploadPdfToSharePoint({
        programId: "program-guid-1",
        programNumber: "PRG-001",
        programName: "Surface Comms",
        deliverableId: "CDRL-005",
        deliverableName: "Monthly Report",
        fileName: "submission.pdf",
        content: new ArrayBuffer(1),
      })
    ).resolves.toMatchObject({
      driveId: "drive-id",
      itemId: "item-id",
      sizeKb: 2,
    });

    expect(folderLookups).toEqual(
      new Set([
        "DRG Submissions",
        "DRG Submissions/PRG-001 - Surface Comms",
        "DRG Submissions/PRG-001 - Surface Comms/CDRL-005 - Monthly Report",
      ])
    );
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        "/root:/DRG%20Submissions/PRG-001%20-%20Surface%20Comms/CDRL-005%20-%20Monthly%20Report/"
      ),
      expect.objectContaining({ method: "PUT" })
    );
  });

  it("deletes readable SharePoint program folders by path", async () => {
    vi.resetModules();
    vi.stubEnv("SHAREPOINT_TENANT_ID", "tenant-id");
    vi.stubEnv("SHAREPOINT_CLIENT_ID", "client-id");
    vi.stubEnv("SHAREPOINT_CLIENT_SECRET", "client-secret");
    vi.stubEnv("SHAREPOINT_SITE_ID", "site-id");
    vi.stubEnv("SHAREPOINT_DRIVE_ID", "drive-id");
    vi.stubEnv("SHAREPOINT_DOCUMENT_FOLDER", "DRG Submissions");

    let deletedPath = "";
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const url = request.url;

      if (url.includes("login.microsoftonline.com")) {
        return jsonResponse({ access_token: "graph-token" });
      }

      if (request.method === "DELETE" && url.includes("/root:/")) {
        expect(request.headers.get("authorization")).toBe("Bearer graph-token");
        deletedPath = decodeURIComponent(url.split("/root:/")[1] ?? "");
        return new Response(null, { status: 204 });
      }

      throw new Error(`Unhandled fetch URL: ${url}`);
    });

    const { deleteProgramFolder } = await import("@/lib/sharepoint/files");

    await expect(
      deleteProgramFolder({
        programNumber: "PRG-001",
        programName: "Surface Comms",
      })
    ).resolves.toBeUndefined();

    expect(deletedPath).toBe("DRG Submissions/PRG-001 - Surface Comms");
  });

  it("deletes legacy GUID-named SharePoint program folders when present", async () => {
    vi.resetModules();
    vi.stubEnv("SHAREPOINT_TENANT_ID", "tenant-id");
    vi.stubEnv("SHAREPOINT_CLIENT_ID", "client-id");
    vi.stubEnv("SHAREPOINT_CLIENT_SECRET", "client-secret");
    vi.stubEnv("SHAREPOINT_SITE_ID", "site-id");
    vi.stubEnv("SHAREPOINT_DRIVE_ID", "drive-id");
    vi.stubEnv("SHAREPOINT_DOCUMENT_FOLDER", "DRG Submissions");

    const deletedPaths: string[] = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const url = request.url;

      if (url.includes("login.microsoftonline.com")) {
        return jsonResponse({ access_token: "graph-token" });
      }

      if (request.method === "DELETE" && url.includes("/root:/")) {
        deletedPaths.push(decodeURIComponent(url.split("/root:/")[1] ?? ""));
        return new Response(null, { status: 204 });
      }

      throw new Error(`Unhandled fetch URL: ${url}`);
    });

    const { deleteProgramFolder } = await import("@/lib/sharepoint/files");

    await deleteProgramFolder({
      programNumber: "PRG-001",
      programName: "Surface Comms",
      legacyProgramId: "aa82b438-b749-f111-bec6-000d3a3837db",
    });

    expect(deletedPaths).toEqual([
      "DRG Submissions/PRG-001 - Surface Comms",
      "DRG Submissions/aa82b438-b749-f111-bec6-000d3a3837db - Surface Comms",
    ]);
  });

  it("renames SharePoint program folders when program names change", async () => {
    vi.resetModules();
    vi.stubEnv("SHAREPOINT_TENANT_ID", "tenant-id");
    vi.stubEnv("SHAREPOINT_CLIENT_ID", "client-id");
    vi.stubEnv("SHAREPOINT_CLIENT_SECRET", "client-secret");
    vi.stubEnv("SHAREPOINT_SITE_ID", "site-id");
    vi.stubEnv("SHAREPOINT_DRIVE_ID", "drive-id");
    vi.stubEnv("SHAREPOINT_DOCUMENT_FOLDER", "DRG Submissions");

    let lookupPath = "";
    let renamePayload: Record<string, unknown> | undefined;
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const url = request.url;

      if (url.includes("login.microsoftonline.com")) {
        return jsonResponse({ access_token: "graph-token" });
      }

      if (request.method === "GET" && url.includes("/root:/")) {
        lookupPath = decodeURIComponent(url.split("/root:/")[1] ?? "");
        return jsonResponse({ id: "folder-item-1" });
      }

      if (request.method === "PATCH" && url.includes("/items/folder-item-1")) {
        renamePayload = await request.json();
        return jsonResponse({ id: "folder-item-1" });
      }

      throw new Error(`Unhandled fetch URL: ${url}`);
    });

    const { renameProgramFolder } = await import("@/lib/sharepoint/files");

    await renameProgramFolder({
      oldProgramNumber: "PRG-001",
      oldProgramName: "Old Name",
      programNumber: "PRG-001",
      programName: "New Name",
    });

    expect(lookupPath).toBe("DRG Submissions/PRG-001 - Old Name");
    expect(renamePayload).toEqual({ name: "PRG-001 - New Name" });
  });

  it("renames legacy GUID-named SharePoint program folders before creating replacements", async () => {
    vi.resetModules();
    vi.stubEnv("SHAREPOINT_TENANT_ID", "tenant-id");
    vi.stubEnv("SHAREPOINT_CLIENT_ID", "client-id");
    vi.stubEnv("SHAREPOINT_CLIENT_SECRET", "client-secret");
    vi.stubEnv("SHAREPOINT_SITE_ID", "site-id");
    vi.stubEnv("SHAREPOINT_DRIVE_ID", "drive-id");
    vi.stubEnv("SHAREPOINT_DOCUMENT_FOLDER", "DRG Submissions");

    const lookupPaths: string[] = [];
    let renamePayload: Record<string, unknown> | undefined;
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const url = request.url;

      if (url.includes("login.microsoftonline.com")) {
        return jsonResponse({ access_token: "graph-token" });
      }

      if (request.method === "GET" && url.includes("/root:/")) {
        const path = decodeURIComponent(url.split("/root:/")[1] ?? "");
        lookupPaths.push(path);

        if (path === "DRG Submissions/PRG-001 - Old Name") {
          return new Response(null, { status: 404 });
        }

        return jsonResponse({ id: "legacy-folder-item-1" });
      }

      if (
        request.method === "PATCH" &&
        url.includes("/items/legacy-folder-item-1")
      ) {
        renamePayload = await request.json();
        return jsonResponse({ id: "legacy-folder-item-1" });
      }

      throw new Error(`Unhandled fetch URL: ${url}`);
    });

    const { renameProgramFolder } = await import("@/lib/sharepoint/files");

    await renameProgramFolder({
      oldProgramNumber: "PRG-001",
      oldProgramName: "Old Name",
      programNumber: "PRG-001",
      programName: "New Name",
      legacyProgramId: "aa82b438-b749-f111-bec6-000d3a3837db",
    });

    expect(lookupPaths).toEqual([
      "DRG Submissions/PRG-001 - Old Name",
      "DRG Submissions/aa82b438-b749-f111-bec6-000d3a3837db - Old Name",
    ]);
    expect(renamePayload).toEqual({ name: "PRG-001 - New Name" });
  });

  it("blocks upload actions for archived programs", async () => {
    const { canUploadToProgram } = await import("@/lib/auth/guards");
    const program = createProgram({
      status: "Archived",
      access: [
        {
          id: "access-1",
          programId: "program-1",
          email: "staff@drg.test",
          accessRole: "DRG Staff",
          isActive: true,
          grantedAt: "",
          grantedByEmail: "admin@drg.test",
        },
      ],
    });

    expect(
      canUploadToProgram(
        { email: "staff@drg.test", internalRoles: ["drg-staff"] },
        program
      )
    ).toBe(false);
  });

  it("allows program-owner-group users with DRG Staff program access to work as staff", async () => {
    const {
      canApproveDeliverableDraft,
      canCreateDeliverable,
      canManageProgramAccess,
      canUploadToProgram,
      canWorkProgram,
    } = await import("@/lib/auth/guards");
    const program = createProgram({
      access: [
        {
          id: "access-1",
          programId: "program-1",
          email: "eligible-owner@drg.test",
          accessRole: "DRG Staff",
          isActive: true,
          grantedAt: "",
          grantedByEmail: "admin@drg.test",
        },
      ],
    });
    const user = {
      email: "eligible-owner@drg.test",
      internalRoles: ["drg-program-owner" as const],
    };

    expect(canWorkProgram(user, program)).toBe(true);
    expect(canCreateDeliverable(user, program)).toBe(true);
    expect(canUploadToProgram(user, program)).toBe(true);
    expect(canManageProgramAccess(user, program)).toBe(false);
    expect(canApproveDeliverableDraft(user, program)).toBe(false);
  });

  it("lets program-owner eligibility group members be granted DRG Staff access", async () => {
    vi.resetModules();
    vi.stubEnv("AZURE_TENANT_ID", "tenant-id");
    vi.stubEnv("AZURE_GRAPH_CLIENT_ID", "client-id");
    vi.stubEnv("AZURE_GRAPH_CLIENT_SECRET", "client-secret");
    vi.stubEnv("ENTRA_DRG_PROGRAM_OWNER_GROUP_ID", "program-owner-group-id");
    vi.stubEnv("ENTRA_DRG_STAFF_GROUP_ID", "staff-group-id");
    vi.stubEnv("ENTRA_EXTERNAL_REVIEWER_GROUP_ID", "reviewer-group-id");

    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();

      if (url.includes("login.microsoftonline.com")) {
        return jsonResponse({ access_token: "graph-token" });
      }

      if (url.includes("graph.microsoft.com/v1.0/users?")) {
        return jsonResponse({
          value: [
            {
              id: "owner-user-id",
              mail: "eligible-owner@drg.test",
              displayName: "Eligible Owner",
            },
          ],
        });
      }

      if (
        url.includes(
          "graph.microsoft.com/v1.0/users/owner-user-id/transitiveMemberOf"
        )
      ) {
        return jsonResponse({
          value: [{ id: "program-owner-group-id" }],
        });
      }

      throw new Error(`Unhandled fetch URL: ${url}`);
    });

    const { getProgramCollaboratorPrincipal } = await import("@/lib/graph/users");

    await expect(
      getProgramCollaboratorPrincipal(
        "eligible-owner@drg.test",
        "External Reviewer"
      )
    ).resolves.toBeNull();

    await expect(
      getProgramCollaboratorPrincipal("eligible-owner@drg.test", "DRG Staff")
    ).resolves.toMatchObject({
      email: "eligible-owner@drg.test",
      accessRole: "DRG Staff",
      eligibleAccessRoles: ["Program Owner", "DRG Staff"],
    });
  });

  it("requires comments when rejecting an approval", async () => {
    vi.resetModules();
    const { submitApprovalDecision } = await import("@/lib/dataverse/approvals");
    const program = createProgram({
      access: [
        {
          id: "access-1",
          programId: "program-1",
          email: "reviewer@gov.test",
          accessRole: "External Reviewer",
          isActive: true,
          grantedAt: "",
          grantedByEmail: "admin@drg.test",
        },
      ],
    });

    await expect(
      submitApprovalDecision({
        user: {
          email: "reviewer@gov.test",
          internalRoles: ["external-reviewer"],
        },
        program,
        approval: createApproval(),
        approvalId: "approval-1",
        decision: "Rejected",
        comments: " ",
      })
    ).rejects.toMatchObject({ code: "rejectionCommentsRequired" });
  });

  it("requires a signed approval PDF when approving", async () => {
    vi.resetModules();
    const { submitApprovalDecision } = await import("@/lib/dataverse/approvals");
    const program = createProgram({
      access: [
        {
          id: "access-1",
          programId: "program-1",
          email: "reviewer@gov.test",
          accessRole: "External Reviewer",
          isActive: true,
          grantedAt: "",
          grantedByEmail: "admin@drg.test",
        },
      ],
    });

    await expect(
      submitApprovalDecision({
        user: {
          email: "reviewer@gov.test",
          internalRoles: ["external-reviewer"],
        },
        program,
        approval: createApproval(),
        approvalId: "approval-1",
        decision: "Approved",
      })
    ).rejects.toMatchObject({ code: "signedApprovalPdfRequired" });
  });

  it("moves the deliverable to Returned when a reviewer rejects an approval", async () => {
    vi.resetModules();
    configureDataverseEnv();
    const patchPayloads: Record<string, unknown>[] = [];
    global.fetch = createDataverseFetchMock({
      "drg_approval')/Attributes(LogicalName='drg_decision')": () =>
        jsonResponse({
          GlobalOptionSet: {
            Options: [
              {
                Value: 100000001,
                Label: { UserLocalizedLabel: { Label: "Rejected" } },
              },
            ],
          },
        }),
      "drg_deliverable')/Attributes(LogicalName='drg_status')": () =>
        jsonResponse({
          GlobalOptionSet: {
            Options: [
              {
                Value: 100000004,
                Label: { UserLocalizedLabel: { Label: "Returned" } },
              },
            ],
          },
        }),
      "/drg_approvals(approval-1)": async (request) => {
        patchPayloads.push(await request.json());
        return new Response(null, { status: 204 });
      },
      "/drg_deliverables(deliverable-1)": async (request) => {
        patchPayloads.push(await request.json());
        return new Response(null, { status: 204 });
      },
    });

    const { submitApprovalDecision } = await import("@/lib/dataverse/approvals");
    const program = createProgram({
      access: [
        {
          id: "access-1",
          programId: "program-1",
          email: "reviewer@gov.test",
          accessRole: "External Reviewer",
          isActive: true,
          grantedAt: "",
          grantedByEmail: "admin@drg.test",
        },
      ],
    });

    await submitApprovalDecision({
      user: {
        email: "reviewer@gov.test",
        internalRoles: ["external-reviewer"],
      },
      program,
      approval: createApproval(),
      approvalId: "approval-1",
      decision: "Rejected",
      comments: "Needs the signed cover page.",
    });

    expect(patchPayloads).toEqual([
      expect.objectContaining({
        drg_decision: 100000001,
        drg_comments: "Needs the signed cover page.",
        drg_decisiondate: expect.any(String),
      }),
      { drg_status: 100000004 },
    ]);
  });

  it("creates the expected Dataverse document access log payload", async () => {
    vi.resetModules();
    configureDataverseEnv();
    let accessLogPayload: Record<string, unknown> | undefined;
    global.fetch = createDataverseFetchMock({
      "/systemusers?": () =>
        jsonResponse({
          value: [{ systemuserid: "dataverse-user-1" }],
        }),
      "Attributes(LogicalName='drg_action')": () =>
        jsonResponse({
          GlobalOptionSet: {
            Options: [
              {
                Value: 100000000,
                Label: { UserLocalizedLabel: { Label: "View" } },
              },
              {
                Value: 100000001,
                Label: { UserLocalizedLabel: { Label: "Download" } },
              },
              {
                Value: 100000002,
                Label: { UserLocalizedLabel: { Label: "Upload" } },
              },
            ],
          },
        }),
      "/drg_documentaccesslogs": async (request) => {
        accessLogPayload = await request.json();
        return new Response(null, { status: 204 });
      },
    });

    const { createDocumentAccessLog } = await import(
      "@/lib/dataverse/document-access-logs"
    );
    await createDocumentAccessLog({
      documentId: "document-1",
      programId: "program-1",
      actorUserId: "entra-object-id-1",
      actorName: "DRG Staff",
      actorEmail: "staff@drg.test",
      action: "Download",
    });

    expect(accessLogPayload).toMatchObject({
      drg_name: expect.stringContaining("Download | staff@drg.test |"),
      "drg_document@odata.bind": "/drg_documents(document-1)",
      "drg_program@odata.bind": "/drg_programs(program-1)",
      "drg_actoruser@odata.bind": "/systemusers(dataverse-user-1)",
      drg_actorname: "DRG Staff",
      drg_actoremail: "staff@drg.test",
      drg_action: 100000001,
    });
    expect(accessLogPayload?.drg_occurredon).toEqual(expect.any(String));
  });

  it("limits document access logging to uploads and external reviewer access", async () => {
    vi.resetModules();
    const { shouldCreateDocumentAccessLog } = await import(
      "@/lib/dataverse/document-access-logs"
    );

    expect(
      shouldCreateDocumentAccessLog({
        action: "View",
        internalRoles: ["external-reviewer"],
      })
    ).toBe(true);
    expect(
      shouldCreateDocumentAccessLog({
        action: "Download",
        internalRoles: ["drg-program-owner"],
      })
    ).toBe(false);
    expect(
      shouldCreateDocumentAccessLog({
        action: "Upload",
        internalRoles: ["drg-staff"],
      })
    ).toBe(true);
    expect(
      shouldCreateDocumentAccessLog({
        action: "Acknowledge",
        internalRoles: ["drg-admin"],
      })
    ).toBe(false);
  });

  it("sends the expected Power Automate acknowledgment payload", async () => {
    vi.resetModules();
    vi.stubEnv(
      "POWER_AUTOMATE_APPROVAL_ACKNOWLEDGED_URL",
      "https://flow.test/acknowledge"
    );
    let flowPayload: Record<string, unknown> | undefined;
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      flowPayload = await request.json();
      return jsonResponse({ ok: true });
    });

    const { acknowledgeSignedApprovalFlow } = await import(
      "@/lib/power-automate/flows"
    );
    const result = await acknowledgeSignedApprovalFlow({
      deliverableId: "deliverable-1",
      acceptedSubmissionDocumentId: "submission-1",
      signedApprovalDocumentId: "signed-approval-1",
      approvalId: "approval-1",
      acknowledgedByEmail: "staff@drg.test",
      acknowledgedByName: "DRG Staff",
      acknowledgedByUserId: "user-1",
    });

    expect(result).toEqual({ skipped: false });
    expect(global.fetch).toHaveBeenCalledWith(
      "https://flow.test/acknowledge",
      expect.objectContaining({ method: "POST" })
    );
    expect(flowPayload).toEqual({
      deliverableId: "deliverable-1",
      acceptedSubmissionDocumentId: "submission-1",
      signedApprovalDocumentId: "signed-approval-1",
      approvalId: "approval-1",
      acknowledgedByEmail: "staff@drg.test",
      acknowledgedByName: "DRG Staff",
      acknowledgedByUserId: "user-1",
    });
  });

  it("keeps mock connector fixtures out of production page imports", async () => {
    const repoRoot = process.cwd();
    const productionPages = [
      "src/app/page.tsx",
      "src/app/programs/page.tsx",
      "src/app/programs/[id]/page.tsx",
      "src/app/programs/[id]/access/page.tsx",
      "src/app/programs/archived/page.tsx",
      "src/app/records/page.tsx",
      "src/app/records/[id]/page.tsx",
      "src/app/documents/page.tsx",
      "src/app/documents/[id]/page.tsx",
      "src/app/submit/page.tsx",
    ];

    await Promise.all(
      productionPages.map(async (relativePath) => {
        const source = await readFile(path.join(repoRoot, relativePath), "utf8");
        expect(source, relativePath).not.toMatch(/@\/lib\/connectors\/mock-/);
      })
    );
  });
});
