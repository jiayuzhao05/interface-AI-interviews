import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { replay } from "../replay/engine.ts";
import type { Capability, VariantOverlay } from "../schema/capability.ts";
import { PlaywrightSurface } from "../surface/playwright-surface.ts";
import { CatalogError, catalogDocument, loadCatalog, loadVariantOverlays, parseInvoke } from "./catalog.ts";

const maxBodyBytes = 32_768;

export function listenCatalog(options?: {
  port?: number;
  origin?: string;
  capabilities?: Capability[];
  variants?: VariantOverlay[];
}): Promise<{ port: number; close: () => Promise<void> }> {
  const origin = options?.origin ?? "http://127.0.0.1:4173";
  const capabilities = options?.capabilities ?? loadCatalog();
  const variants = options?.variants ?? loadVariantOverlays();
  const server = createServer((req, res) => {
    void handle(req, res, capabilities, variants, origin).catch((error: unknown) => {
      const status = error instanceof CatalogError ? error.status : 500;
      const message = error instanceof Error ? error.message : String(error);
      send(res, status, { error: message });
    });
  });

  return new Promise((resolve) => {
    server.listen(options?.port ?? 0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : (options?.port ?? 0);
      resolve({
        port,
        close: () =>
          new Promise((done, reject) => {
            server.close((error) => (error ? reject(error) : done()));
          }),
      });
    });
  });
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  capabilities: Capability[],
  variants: VariantOverlay[],
  origin: string,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (req.method === "GET" && url.pathname === "/v1/capabilities") {
    send(res, 200, catalogDocument(capabilities, variants));
    return;
  }

  const match = /^\/v1\/capabilities\/([^/]+)\/invoke$/.exec(url.pathname);
  if (req.method !== "POST" || !match) throw new CatalogError(404, "Not found.");
  const name = decodeURIComponent(match[1] ?? "");
  const capability = capabilities.find((item) => item.name === name);
  if (!capability) throw new CatalogError(404, `No capability "${name}".`);

  const { params, variant } = parseInvoke(capability, variants, await readJson(req));
  const surface = await PlaywrightSurface.launch({ headless: true });
  try {
    const result = await replay(surface, { capability, params, variant, origin });
    send(res, 200, result);
  } finally {
    await surface.close();
  }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBodyBytes) throw new CatalogError(400, "Request body is too large.");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new CatalogError(400, "Request body must be JSON.");
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}
