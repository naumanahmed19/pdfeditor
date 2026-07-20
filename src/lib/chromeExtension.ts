export interface ChromePdfStream {
  bytes: Uint8Array;
  name: string;
  originalUrl: string;
  embedded: boolean;
}

interface ChromeStreamInfo {
  streamUrl: string;
  originalUrl: string;
  responseHeaders?: Record<string, string>;
  embedded?: boolean;
}

interface ChromeMimeHandlerApi {
  getStreamInfo(): Promise<ChromeStreamInfo>;
  abortAndFallbackToNativeHandler(): Promise<void>;
}

interface ChromeExtensionApi {
  runtime?: { id?: string; getURL?(path: string): string };
  mimeHandler?: ChromeMimeHandlerApi;
}

function chromeApi(): ChromeExtensionApi | null {
  const api = (globalThis as { chrome?: ChromeExtensionApi }).chrome;
  return api?.runtime?.id ? api : null;
}

export function chromeExtensionAssetUrl(path: string): string | null {
  const runtime = chromeApi()?.runtime;
  return runtime?.getURL ? runtime.getURL(path) : null;
}

function header(
  headers: Record<string, string> | undefined,
  wanted: string,
): string | undefined {
  if (!headers) return undefined;
  const key = Object.keys(headers).find(
    (candidate) => candidate.toLowerCase() === wanted.toLowerCase(),
  );
  return key ? headers[key] : undefined;
}

function decodeFilename(value: string): string | null {
  try {
    return decodeURIComponent(value.replace(/^UTF-8''/i, ""));
  } catch {
    return value || null;
  }
}

export function chromePdfFilename(
  originalUrl: string,
  responseHeaders?: Record<string, string>,
): string {
  const disposition = header(responseHeaders, "content-disposition") ?? "";
  const encoded = disposition.match(/filename\*\s*=\s*([^;]+)/i)?.[1]?.trim();
  const quoted = disposition.match(/filename\s*=\s*"([^"]+)"/i)?.[1];
  const plain = disposition.match(/filename\s*=\s*([^;]+)/i)?.[1]?.trim();
  const fromHeader = decodeFilename(
    (encoded ?? quoted ?? plain ?? "").replace(/^['"]|['"]$/g, ""),
  );
  if (fromHeader) {
    return fromHeader.toLowerCase().endsWith(".pdf")
      ? fromHeader
      : `${fromHeader}.pdf`;
  }

  try {
    const segment = new URL(originalUrl).pathname.split("/").filter(Boolean).pop();
    const decoded = segment ? decodeFilename(segment) : null;
    if (decoded) return decoded.toLowerCase().endsWith(".pdf") ? decoded : `${decoded}.pdf`;
  } catch {
    /* Non-standard source URL — use the stable fallback below. */
  }
  return "document.pdf";
}

/**
 * Return the PDF stream only when Chrome loaded this page as a MIME handler.
 * A normal toolbar launch uses the same index page; getStreamInfo rejects in
 * that context and is intentionally treated as "no stream".
 */
export async function readChromePdfStream(): Promise<ChromePdfStream | null> {
  const mimeHandler = chromeApi()?.mimeHandler;
  if (!mimeHandler) return null;

  let info: ChromeStreamInfo;
  try {
    info = await mimeHandler.getStreamInfo();
  } catch {
    return null;
  }

  const response = await fetch(info.streamUrl);
  if (!response.ok) {
    throw new Error(`Chrome returned PDF stream status ${response.status}.`);
  }
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    name: chromePdfFilename(info.originalUrl, info.responseHeaders),
    originalUrl: info.originalUrl,
    embedded: info.embedded === true,
  };
}

export async function fallbackToChromePdfViewer(): Promise<void> {
  const mimeHandler = chromeApi()?.mimeHandler;
  if (!mimeHandler) return;
  try {
    await mimeHandler.abortAndFallbackToNativeHandler();
  } catch {
    // This also rejects on ordinary extension pages, where there is no native
    // handler context to fall back to.
  }
}
