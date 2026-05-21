import "server-only";

import { cache } from "react";
import { businessRuleError } from "@/lib/errors/business-rules";

export interface SharePointFileResult {
  siteUrl: string;
  driveId: string;
  itemId: string;
  webUrl: string;
  sizeKb: number;
}

export interface SharePointDownloadInput {
  driveId: string;
  itemId: string;
}

const GRAPH_REQUEST_TIMEOUT_MS = Number(
  process.env.GRAPH_REQUEST_TIMEOUT_MS ?? 45_000
);

function isSharePointConfigured() {
  return Boolean(
    process.env.SHAREPOINT_TENANT_ID &&
      process.env.SHAREPOINT_CLIENT_ID &&
      process.env.SHAREPOINT_CLIENT_SECRET &&
      process.env.SHAREPOINT_SITE_ID &&
      process.env.SHAREPOINT_DRIVE_ID
  );
}

export function isSharePointUploadConfigured() {
  return isSharePointConfigured();
}

async function fetchGraph(input: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GRAPH_REQUEST_TIMEOUT_MS);

  try {
    return await fetch(input, {
      ...init,
      signal: init.signal ?? controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Microsoft Graph request timed out.");
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

const getGraphToken = cache(async () => {
  if (!isSharePointConfigured()) {
    throw new Error("SharePoint is not configured.");
  }

  const body = new URLSearchParams({
    client_id: process.env.SHAREPOINT_CLIENT_ID ?? "",
    client_secret: process.env.SHAREPOINT_CLIENT_SECRET ?? "",
    grant_type: "client_credentials",
    scope: "https://graph.microsoft.com/.default",
  });

  const response = await fetchGraph(
    `https://login.microsoftonline.com/${process.env.SHAREPOINT_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      cache: "no-store",
    }
  );

  if (!response.ok) {
    throw new Error(`SharePoint token request failed: ${response.status}`);
  }

  const json = (await response.json()) as { access_token?: string };
  if (!json.access_token) {
    throw new Error("SharePoint token response did not include an access token.");
  }

  return json.access_token;
});

function encodePathSegment(segment: string) {
  return segment.replace(/[\\/:*?"<>|]/g, "-");
}

function getReadableFolderName(id: string, name?: string) {
  const readableName = name?.trim();
  return encodePathSegment(readableName ? `${id} - ${readableName}` : id);
}

function getProgramFolderPath(programNumber: string, programName?: string) {
  const baseFolder = process.env.SHAREPOINT_DOCUMENT_FOLDER ?? "DRG Submissions";
  return [baseFolder, getReadableFolderName(programNumber, programName)].join("/");
}

function splitSharePointPath(path: string) {
  const segments = path.split("/").filter(Boolean);
  return {
    parentPath: segments.slice(0, -1).join("/"),
    name: segments.at(-1) ?? "",
  };
}

function getSharePointFolderPath(input: {
  programId: string;
  programNumber?: string;
  deliverableId: string;
  deliverableNumber?: string;
  programName?: string;
  deliverableName?: string;
}) {
  const baseFolder = process.env.SHAREPOINT_DOCUMENT_FOLDER ?? "DRG Submissions";
  const folderStrategy =
    process.env.SHAREPOINT_FOLDER_STRATEGY ?? "program-deliverable";

  if (folderStrategy === "flat") {
    return baseFolder;
  }

  return [
    baseFolder,
    getReadableFolderName(input.programNumber ?? input.programId, input.programName),
    getReadableFolderName(
      input.deliverableNumber ?? input.deliverableId,
      input.deliverableName
    ),
  ].join("/");
}

function getStoredFileName(fileName: string) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${timestamp}-${encodePathSegment(fileName)}`;
}

function toGraphPath(path: string) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function getDriveGraphBaseUrl(driveId: string) {
  const siteId = process.env.SHAREPOINT_SITE_ID ?? "";
  return `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(
    siteId
  )}/drives/${encodeURIComponent(driveId)}`;
}

async function getDriveItemByPath(token: string, driveId: string, path: string) {
  return fetchGraph(
    `${getDriveGraphBaseUrl(driveId)}/root:/${toGraphPath(path)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    }
  );
}

async function createFolder(
  token: string,
  driveId: string,
  parentPath: string,
  name: string
) {
  const parentSelector = parentPath
    ? `root:/${toGraphPath(parentPath)}:/children`
    : "root/children";
  const response = await fetchGraph(
    `${getDriveGraphBaseUrl(driveId)}/${parentSelector}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name,
        folder: {},
        "@microsoft.graph.conflictBehavior": "fail",
      }),
      cache: "no-store",
    }
  );

  if (response.ok || response.status === 409) {
    return;
  }

  const details = await response.text().catch(() => "");
  throw new Error(
    `SharePoint folder creation failed: ${response.status}${
      details ? ` - ${details}` : ""
    }`
  );
}

export async function ensureSharePointFolderPath(path: string) {
  const token = await getGraphToken();
  const driveId = process.env.SHAREPOINT_DRIVE_ID ?? "";
  const segments = path.split("/").map(encodePathSegment).filter(Boolean);
  let currentPath = "";

  for (const segment of segments) {
    const nextPath = currentPath ? `${currentPath}/${segment}` : segment;
    const response = await getDriveItemByPath(token, driveId, nextPath);

    if (response.ok) {
      currentPath = nextPath;
      continue;
    }

    if (response.status !== 404) {
      const details = await response.text().catch(() => "");
      throw new Error(
        `SharePoint folder lookup failed: ${response.status}${
          details ? ` - ${details}` : ""
        }`
      );
    }

    await createFolder(token, driveId, currentPath, segment);
    currentPath = nextPath;
  }
}

export async function deleteSharePointFolderPath(path: string) {
  const token = await getGraphToken();
  const driveId = process.env.SHAREPOINT_DRIVE_ID ?? "";
  const response = await fetch(
    `${getDriveGraphBaseUrl(driveId)}/root:/${toGraphPath(path)}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    }
  );

  if (response.ok || response.status === 404) {
    return;
  }

  const details = await response.text().catch(() => "");
  throw new Error(
    `SharePoint folder deletion failed: ${response.status}${
      details ? ` - ${details}` : ""
    }`
  );
}

export async function ensureProgramFolder(input: {
  programNumber: string;
  programName: string;
}) {
  await ensureSharePointFolderPath(
    getProgramFolderPath(input.programNumber, input.programName)
  );
}

export async function deleteProgramFolder(input: {
  programNumber: string;
  programName: string;
  legacyProgramId?: string;
}) {
  await deleteSharePointFolderPath(
    getProgramFolderPath(input.programNumber, input.programName)
  );

  if (input.legacyProgramId && input.legacyProgramId !== input.programNumber) {
    await deleteSharePointFolderPath(
      getProgramFolderPath(input.legacyProgramId, input.programName)
    );
  }
}

export async function renameProgramFolder(input: {
  oldProgramNumber: string;
  oldProgramName: string;
  programNumber: string;
  programName: string;
  legacyProgramId?: string;
}) {
  const newPath = getProgramFolderPath(input.programNumber, input.programName);
  const candidateOldPaths = [
    getProgramFolderPath(input.oldProgramNumber, input.oldProgramName),
    ...(input.legacyProgramId && input.legacyProgramId !== input.oldProgramNumber
      ? [getProgramFolderPath(input.legacyProgramId, input.oldProgramName)]
      : []),
  ];

  if (candidateOldPaths.includes(newPath)) return;

  const token = await getGraphToken();
  const driveId = process.env.SHAREPOINT_DRIVE_ID ?? "";
  let existingFolderResponse: Response | undefined;

  for (const oldPath of candidateOldPaths) {
    const response = await getDriveItemByPath(token, driveId, oldPath);
    if (response.status === 404) continue;

    existingFolderResponse = response;
    break;
  }

  if (!existingFolderResponse) {
    await ensureSharePointFolderPath(newPath);
    return;
  }

  if (!existingFolderResponse.ok) {
    const details = await existingFolderResponse.text().catch(() => "");
    throw new Error(
      `SharePoint folder lookup failed before rename: ${existingFolderResponse.status}${
        details ? ` - ${details}` : ""
      }`
    );
  }

  const existingFolder = (await existingFolderResponse.json()) as { id?: string };
  if (!existingFolder.id) {
    throw new Error("SharePoint folder lookup did not return an item ID.");
  }

  const { name } = splitSharePointPath(newPath);
  const response = await fetch(
    `${getDriveGraphBaseUrl(driveId)}/items/${encodeURIComponent(
      existingFolder.id
    )}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name }),
      cache: "no-store",
    }
  );

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(
      `SharePoint folder rename failed: ${response.status}${
        details ? ` - ${details}` : ""
      }`
    );
  }
}

export async function ensureDeliverableFolder(input: {
  programId: string;
  programNumber?: string;
  deliverableId: string;
  deliverableNumber?: string;
  programName: string;
  deliverableName: string;
}) {
  await ensureSharePointFolderPath(getSharePointFolderPath(input));
}

export async function deleteDeliverableFolder(input: {
  programId: string;
  programNumber?: string;
  deliverableId: string;
  deliverableNumber?: string;
  programName: string;
  deliverableName: string;
}) {
  if ((process.env.SHAREPOINT_FOLDER_STRATEGY ?? "program-deliverable") === "flat") {
    return;
  }

  await deleteSharePointFolderPath(getSharePointFolderPath(input));
}

export async function fetchSharePointFile(input: SharePointDownloadInput) {
  const token = await getGraphToken();

  if (!input.driveId || !input.itemId) {
    throw new Error("Missing SharePoint drive ID or item ID.");
  }

  const response = await fetch(
    `${getDriveGraphBaseUrl(input.driveId)}/items/${encodeURIComponent(
      input.itemId
    )}/content`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    }
  );

  if (!response.ok || !response.body) {
    const details = await response.text().catch(() => "");
    throw new Error(
      `SharePoint download failed: ${response.status}${
        details ? ` - ${details}` : ""
      }`
    );
  }

  return response;
}

export async function deleteSharePointFile(input: SharePointDownloadInput) {
  const token = await getGraphToken();

  if (!input.driveId || !input.itemId) {
    throw new Error("Missing SharePoint drive ID or item ID.");
  }

  const response = await fetch(
    `${getDriveGraphBaseUrl(input.driveId)}/items/${encodeURIComponent(
      input.itemId
    )}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    }
  );

  if (response.ok || response.status === 404) {
    return;
  }

  const details = await response.text().catch(() => "");
  throw new Error(
    `SharePoint file deletion failed: ${response.status}${
      details ? ` - ${details}` : ""
    }`
  );
}

export async function uploadPdfToSharePoint(input: {
  programId: string;
  programNumber?: string;
  deliverableId: string;
  deliverableNumber?: string;
  programName?: string;
  deliverableName?: string;
  fileName: string;
  content: Blob | ArrayBuffer;
}): Promise<SharePointFileResult> {
  if (!input.fileName.toLowerCase().endsWith(".pdf")) {
    throw businessRuleError("pdfRequired");
  }

  const token = await getGraphToken();
  const driveId = process.env.SHAREPOINT_DRIVE_ID ?? "";
  const folderPath = getSharePointFolderPath(input);
  await ensureSharePointFolderPath(folderPath);
  const path = `${folderPath}/${getStoredFileName(input.fileName)}`;

  const response = await fetchGraph(
    `${getDriveGraphBaseUrl(driveId)}/root:/${toGraphPath(
      path
    )}:/content`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/pdf",
      },
      body: input.content instanceof Blob ? input.content : new Blob([input.content]),
      cache: "no-store",
    }
  );

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(
      `SharePoint upload failed: ${response.status}${details ? ` - ${details}` : ""}`
    );
  }

  const item = (await response.json()) as {
    id: string;
    webUrl: string;
    size?: number;
    parentReference?: { driveId?: string; siteId?: string };
  };

  return {
    siteUrl: process.env.SHAREPOINT_SITE_URL ?? "",
    driveId: item.parentReference?.driveId ?? driveId,
    itemId: item.id,
    webUrl: item.webUrl,
    sizeKb: Math.ceil((item.size ?? 0) / 1024),
  };
}
