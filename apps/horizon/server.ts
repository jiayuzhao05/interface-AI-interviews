import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { findMember, type Member } from "./members.ts";
import {
  confirmationPage,
  detailPanel,
  submittedPage,
  detailShell,
  missingMemberPage,
  NICKNAME_REQUIRED,
  notFoundPage,
  noticePage,
  NOT_FOUND_MESSAGE,
  portalPage,
  productLabel,
  PRODUCT_REQUIRED,
  requiredMessage,
  searchPage,
  subAccountForm,
} from "./pages.ts";
import { href, matchVariant, type Variant } from "./variants.ts";

const PORT = Number(process.env.PORT ?? 4173);
const HOST = "127.0.0.1";
const MAX_BODY_BYTES = 32_768;
const NOTICE_COOKIE = "branch_notice";

type HeaderValue = string | number | string[];

type HttpResult = {
  status: number;
  headers?: Record<string, HeaderValue>;
  body: string;
};

function html(status: number, body: string, headers?: Record<string, HeaderValue>): HttpResult {
  return {
    status,
    body,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  };
}

function redirect(location: string, headers?: Record<string, HeaderValue>): HttpResult {
  return {
    status: 303,
    body: "",
    headers: { location, "cache-control": "no-store", ...headers },
  };
}

function readCookies(req: IncomingMessage): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) return {};
  const cookies: Record<string, string> = {};
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function noticeDismissed(req: IncomingMessage): boolean {
  return readCookies(req)[NOTICE_COOKIE] === "dismissed";
}

async function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      throw new Error("Request body is too large.");
    }
    chunks.push(buffer);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

function lookupError(variant: Variant, error: string | null): string | undefined {
  if (error === "required") return requiredMessage(variant.memberFieldLabel);
  if (error === "missing") return NOT_FOUND_MESSAGE;
  return undefined;
}

function normalizePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname;
}

async function route(req: IncomingMessage): Promise<HttpResult> {
  const url = new URL(req.url ?? "/", `http://${HOST}`);
  const pathname = normalizePath(url.pathname);
  const method = req.method ?? "GET";

  if (method === "GET" && pathname === "/") return html(200, portalPage());

  const { variant, rest } = matchVariant(pathname);

  if (method === "GET" && (rest === "/" || rest === "")) {
    return redirect(href(variant, "/members"));
  }

  if (method === "POST" && rest === "/notice/dismiss") {
    if (!variant.blocksLookupUntilNotice) return html(404, notFoundPage(variant));
    return redirect(href(variant, "/members"), {
      "set-cookie": `${NOTICE_COOKIE}=dismissed; Path=/cu; HttpOnly; SameSite=Lax`,
    });
  }

  const lookupBlocked = variant.blocksLookupUntilNotice && !noticeDismissed(req);

  if (method === "GET" && rest === "/members") {
    if (lookupBlocked) return html(200, noticePage(variant));
    const message = lookupError(variant, url.searchParams.get("error"));
    return html(
      200,
      searchPage(variant, {
        memberNumber: url.searchParams.get("memberNumber") ?? "",
        messages: message ? [message] : [],
      }),
    );
  }

  if (method === "POST" && rest === "/members/lookup") {
    if (lookupBlocked) return html(200, noticePage(variant));
    const form = await readForm(req);
    const memberNumber = (form.get("memberNumber") ?? "").trim().slice(0, 32);
    if (!memberNumber) {
      const params = new URLSearchParams({ error: "required" });
      return redirect(`${href(variant, "/members")}?${params}`);
    }
    if (!findMember(memberNumber)) {
      const params = new URLSearchParams({ error: "missing", memberNumber });
      return redirect(`${href(variant, "/members")}?${params}`);
    }
    return redirect(href(variant, `/members/${memberNumber}`));
  }

  const detailMatch = /^\/members\/([0-9]+)$/.exec(rest);
  const panelMatch = /^\/members\/([0-9]+)\/panel$/.exec(rest);
  const subMatch = /^\/members\/([0-9]+)\/sub-account$/.exec(rest);
  const confirmMatch = /^\/members\/([0-9]+)\/sub-account\/confirmation$/.exec(rest);
  const submittedMatch = /^\/members\/([0-9]+)\/sub-account\/submitted$/.exec(rest);
  const memberNumber =
    detailMatch?.[1] ?? panelMatch?.[1] ?? subMatch?.[1] ?? confirmMatch?.[1] ?? submittedMatch?.[1];
  const member = memberNumber ? findMember(memberNumber) : undefined;

  if (detailMatch || panelMatch || subMatch || confirmMatch || submittedMatch) {
    if (!member || !memberNumber) return html(404, missingMemberPage(variant, memberNumber ?? ""));
  }

  if (method === "GET" && detailMatch && member) return html(200, detailShell(variant, member));
  if (method === "GET" && panelMatch && member) return html(200, detailPanel(variant, member));

  if (subMatch && member) {
    if (method === "GET") return html(200, subAccountForm(variant, member, {}));
    if (method === "POST") {
      const form = await readForm(req);
      const product = (form.get("product") ?? "").trim();
      const nickname = (form.get("nickname") ?? "").trim();
      const messages: string[] = [];
      if (!productLabel(product)) messages.push(PRODUCT_REQUIRED);
      if (!nickname) messages.push(NICKNAME_REQUIRED);
      if (messages.length > 0) {
        return html(400, subAccountForm(variant, member, { product, nickname, messages }));
      }
      const params = new URLSearchParams({ product, nickname });
      return redirect(
        `${href(variant, `/members/${member.memberNumber}/sub-account/confirmation`)}?${params}`,
      );
    }
  }

  if (confirmMatch && member) {
    if (method === "GET") {
      const product = url.searchParams.get("product") ?? "";
      const nickname = (url.searchParams.get("nickname") ?? "").trim();
      return confirmOrForm(variant, member, product, nickname);
    }
    if (method === "POST") {
      const form = await readForm(req);
      const product = (form.get("product") ?? "").trim();
      const nickname = (form.get("nickname") ?? "").trim();
      const label = productLabel(product);
      if (!label || !nickname) return confirmOrForm(variant, member, product, nickname);
      const params = new URLSearchParams({ product, nickname });
      return redirect(`${href(variant, `/members/${member.memberNumber}/sub-account/submitted`)}?${params}`);
    }
  }

  if (method === "GET" && submittedMatch && member) {
    const product = url.searchParams.get("product") ?? "";
    const nickname = (url.searchParams.get("nickname") ?? "").trim();
    const label = productLabel(product);
    if (!label || !nickname) return confirmOrForm(variant, member, product, nickname);
    return html(200, submittedPage(variant, member, { productLabel: label, nickname }));
  }

  return html(404, notFoundPage(variant));
}

function confirmOrForm(variant: Variant, member: Member, product: string, nickname: string): HttpResult {
  const label = productLabel(product);
  const messages: string[] = [];
  if (!label) messages.push(PRODUCT_REQUIRED);
  if (!nickname) messages.push(NICKNAME_REQUIRED);
  if (!label || messages.length > 0) {
    return html(400, subAccountForm(variant, member, { product, nickname, messages }));
  }
  return html(200, confirmationPage(variant, member, { product, productLabel: label, nickname }));
}

async function onRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const pathname = new URL(req.url ?? "/", `http://${HOST}`).pathname;
  console.log(`${req.method ?? "GET"} ${pathname}`);
  try {
    const result = await route(req);
    res.writeHead(result.status, result.headers ?? {});
    res.end(result.body);
  } catch (error) {
    console.error(error);
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end("Internal error");
  }
}

const server = createServer((req, res) => {
  void onRequest(req, res);
});

server.listen(PORT, HOST, () => {
  console.log(`Horizon Core sample app at http://${HOST}:${PORT}`);
  console.log(`  base    http://${HOST}:${PORT}/members`);
  console.log(`  variant http://${HOST}:${PORT}/cu/members`);
});
