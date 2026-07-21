import { readFile } from "node:fs/promises";
import { sign } from "node:crypto";

const CHROME_WEBSTORE_SCOPE = "https://www.googleapis.com/auth/chromewebstore";
const CHROME_WEBSTORE_API = "https://chromewebstore.googleapis.com";
const TOKEN_AUDIENCE = "https://oauth2.googleapis.com/token";
const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_ATTEMPTS = 36;

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function parseJson(value, label) {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

async function responseJson(response, operation) {
  const body = await response.text();
  const parsed = body ? parseJson(body, `${operation} response`) : {};
  if (!response.ok) {
    throw new Error(`${operation} failed (${response.status}): ${body}`);
  }
  return parsed;
}

async function createAccessToken(serviceAccount) {
  if (serviceAccount.type !== "service_account") {
    throw new Error("Chrome Web Store credentials must be a service-account JSON key");
  }
  if (!serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error("Service-account JSON is missing client_email or private_key");
  }

  const issuedAt = Math.floor(Date.now() / 1_000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64Url(
    JSON.stringify({
      iss: serviceAccount.client_email,
      scope: CHROME_WEBSTORE_SCOPE,
      aud: serviceAccount.token_uri || TOKEN_AUDIENCE,
      iat: issuedAt,
      exp: issuedAt + 3_600,
    }),
  );
  const unsignedToken = `${header}.${claims}`;
  const signature = sign("RSA-SHA256", Buffer.from(unsignedToken), serviceAccount.private_key);
  const assertion = `${unsignedToken}.${base64Url(signature)}`;

  const response = await fetch(serviceAccount.token_uri || TOKEN_AUDIENCE, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const token = await responseJson(response, "Google access-token request");
  if (!token.access_token) throw new Error("Google access-token response did not include a token");
  return token.access_token;
}

async function chromeRequest(accessToken, url, init, operation) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...init.headers,
    },
  });
  return responseJson(response, operation);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForUpload(accessToken, itemUrl, initialState) {
  if (initialState === "SUCCEEDED") return;
  if (initialState === "FAILED") throw new Error("Chrome Web Store rejected the extension upload");
  if (initialState !== "IN_PROGRESS") {
    throw new Error(`Unexpected Chrome Web Store upload state: ${initialState || "missing"}`);
  }

  for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt += 1) {
    await delay(POLL_INTERVAL_MS);
    const status = await chromeRequest(
      accessToken,
      `${itemUrl}:fetchStatus`,
      { method: "GET" },
      "Chrome Web Store status check",
    );
    const state = status.lastAsyncUploadState;
    console.log(`Chrome Web Store upload status (${attempt}/${MAX_POLL_ATTEMPTS}): ${state}`);
    if (state === "SUCCEEDED") return;
    if (state === "FAILED" || state === "NOT_FOUND") {
      throw new Error(`Chrome Web Store upload ended in state ${state}`);
    }
  }

  throw new Error("Timed out waiting for Chrome Web Store to process the upload");
}

async function main() {
  const packagePath = process.argv[2];
  if (!packagePath) {
    throw new Error("Usage: publish-chrome-extension.mjs <extension.zip>");
  }

  const serviceAccount = parseJson(
    requiredEnvironment("CHROME_WEBSTORE_SERVICE_ACCOUNT_JSON"),
    "CHROME_WEBSTORE_SERVICE_ACCOUNT_JSON",
  );
  const publisherId = requiredEnvironment("CHROME_WEBSTORE_PUBLISHER_ID");
  const extensionId = requiredEnvironment("CHROME_WEBSTORE_EXTENSION_ID");
  const packageBytes = await readFile(packagePath);
  const accessToken = await createAccessToken(serviceAccount);
  const itemUrl = `${CHROME_WEBSTORE_API}/v2/publishers/${publisherId}/items/${extensionId}`;

  console.log(`Uploading ${packagePath} to Chrome Web Store item ${extensionId}`);
  const upload = await chromeRequest(
    accessToken,
    `${CHROME_WEBSTORE_API}/upload/v2/publishers/${publisherId}/items/${extensionId}:upload`,
    {
      method: "POST",
      headers: { "Content-Type": "application/zip" },
      body: packageBytes,
    },
    "Chrome Web Store upload",
  );
  console.log(`Chrome Web Store accepted version ${upload.crxVersion || "(processing)"}`);
  await waitForUpload(accessToken, itemUrl, upload.uploadState);

  const publication = await chromeRequest(
    accessToken,
    `${itemUrl}:publish`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ publishType: "DEFAULT_PUBLISH" }),
    },
    "Chrome Web Store publication",
  );
  console.log(`Chrome Web Store submission state: ${publication.state || "submitted"}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
