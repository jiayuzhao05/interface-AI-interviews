import { createServer, type ServerResponse } from "node:http";
import type { BrowserSession } from "./session.ts";

export function listenInterventions(
  session: BrowserSession,
  port = 0,
): Promise<{ port: number; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const match = /^\/v1\/interventions\/([^/]+)\/resume$/.exec(url.pathname);
    if (req.method !== "POST" || !match) {
      send(res, 404, { error: "Not found." });
      return;
    }
    const id = decodeURIComponent(match[1] ?? "");
    void session
      .resume(id)
      .then((intervention) => {
        send(res, 200, {
          id: intervention.id,
          owner: session.owner,
          capability: intervention.capability,
          stepId: intervention.stepId,
          reason: intervention.reason,
          activity: intervention.activity ?? null,
        });
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        send(res, message.includes("not waiting") ? 409 : 404, { error: message });
      });
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      const actual = typeof address === "object" && address ? address.port : port;
      resolve({
        port: actual,
        close: () =>
          new Promise((done, reject) => {
            server.close((error) => (error ? reject(error) : done()));
          }),
      });
    });
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(payload) });
  res.end(payload);
}
