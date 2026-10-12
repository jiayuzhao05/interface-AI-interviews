import { formatMoney, type Member } from "./members.ts";
import { href, productName, type Variant } from "./variants.ts";

export const NOT_FOUND_MESSAGE = "No member matches.";

export const products = [
  { value: "holiday-club", label: "Holiday club" },
  { value: "vacation-club", label: "Vacation club" },
] as const;

export function productLabel(value: string): string | undefined {
  return products.find((product) => product.value === value)?.label;
}

export function requiredMessage(label: string): string {
  return `${label} is required.`;
}

export const PRODUCT_REQUIRED = "Product is required.";
export const NICKNAME_REQUIRED = "Nickname is required.";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const css = `
body { margin: 16px; background: #d4d0c8; color: #111; font: 13px Verdana, Geneva, sans-serif; }
body:not(.framed) > table { width: 720px; }
table { border-collapse: collapse; background: #fff; width: 100%; }
th, td { border: 1px solid #6d6d6d; padding: 6px 8px; vertical-align: top; }
th { background: #0a3472; color: #fff; text-align: left; font-weight: 600; }
td.label { width: 180px; background: #e7e7e7; }
td.error { background: #f8d0d0; font-weight: 700; }
td.notice { background: #fff3bf; }
a { color: #062f78; }
button, input, select { font: inherit; color: #111; }
button { background: #ece9d8; border: 1px solid #404040; padding: 2px 12px; }
input, select { border: 1px solid #404040; padding: 2px 4px; }
iframe { display: block; width: 100%; height: 250px; border: 1px solid #6d6d6d; background: #fff; }
body.framed { margin: 8px; }
body.framed table { width: 100%; }
`;

function documentPage(title: string, body: string, framed = false): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>${css}</style>
</head>
<body${framed ? ' class="framed"' : ""}>
${body}
</body>
</html>`;
}

function chrome(variant: Variant, body: string): string {
  const title = `${productName()} — ${variant.institution}`;
  return documentPage(
    title,
    `<table>
  <tr><th>${escapeHtml(title)}</th></tr>
  <tr><td>${body}</td></tr>
</table>`,
  );
}

function errorRow(messages: string[]): string {
  if (messages.length === 0) return "";
  return `<tr><td class="error" colspan="2">${messages.map(escapeHtml).join("<br>")}</td></tr>`;
}

export function portalPage(): string {
  return documentPage(
    productName(),
    `<table>
  <tr><th>${escapeHtml(productName())}</th></tr>
  <tr><td>Same servicing screens, two institution configurations.</td></tr>
  <tr><td><a href="/members">Horizon Credit Union</a></td></tr>
  <tr><td><a href="/cu/members">Northline Credit Union</a></td></tr>
</table>`,
  );
}

export function noticePage(variant: Variant): string {
  return chrome(
    variant,
    `<form method="post" action="${escapeHtml(href(variant, "/notice/dismiss"))}">
  <table>
    <tr><th>Branch notice</th></tr>
    <tr><td class="notice">Review the branch notice before looking up a member. Dismiss it to continue.</td></tr>
    <tr><td><button type="submit">Dismiss</button></td></tr>
  </table>
</form>`,
  );
}

export function searchPage(
  variant: Variant,
  input: { memberNumber?: string; messages?: string[] },
): string {
  const memberNumber = input.memberNumber ?? "";
  const messages = input.messages ?? [];
  return chrome(
    variant,
    `<form method="post" action="${escapeHtml(href(variant, "/members/lookup"))}">
  <table>
    <tr><th colspan="2">Look up a member</th></tr>
    ${errorRow(messages)}
    <tr>
      <td class="label">${escapeHtml(variant.memberFieldLabel)}</td>
      <td><input name="memberNumber" aria-label="${escapeHtml(variant.memberFieldLabel)}" autocomplete="off" value="${escapeHtml(memberNumber)}"></td>
    </tr>
    <tr><td colspan="2"><button type="submit">Look up</button></td></tr>
  </table>
</form>`,
  );
}

export function detailShell(variant: Variant, member: Member): string {
  const panel = href(variant, `/members/${member.memberNumber}/panel`);
  return chrome(
    variant,
    `<table>
  <tr><th>Member detail</th></tr>
  <tr><td><iframe title="Member detail" src="${escapeHtml(panel)}"></iframe></td></tr>
</table>`,
  );
}

export function detailPanel(variant: Variant, member: Member): string {
  const subAccount = href(variant, `/members/${member.memberNumber}/sub-account`);
  return documentPage(
    `${member.name} — ${variant.institution}`,
    `<table>
  <tr><th colspan="2">Member</th></tr>
  <tr><td class="label">Name</td><td>${escapeHtml(member.name)}</td></tr>
  <tr><td class="label">${escapeHtml(variant.memberFieldLabel)}</td><td>${escapeHtml(member.memberNumber)}</td></tr>
  <tr><td class="label">Savings balance</td><td>${escapeHtml(formatMoney(member.savingsBalanceCents))}</td></tr>
  <tr><td class="label">Share draft balance</td><td>${escapeHtml(formatMoney(member.shareDraftBalanceCents))}</td></tr>
  <tr><td class="label">Status</td><td>${escapeHtml(member.status)}</td></tr>
  <tr><td colspan="2"><a href="${escapeHtml(subAccount)}" target="_top">Open sub-account</a></td></tr>
</table>`,
    true,
  );
}

export function missingMemberPage(variant: Variant, memberNumber: string): string {
  return chrome(
    variant,
    `<table>
  <tr><td class="error">${escapeHtml(NOT_FOUND_MESSAGE)}</td></tr>
  <tr><td>${escapeHtml(variant.memberFieldLabel)} ${escapeHtml(memberNumber)}</td></tr>
  <tr><td><a href="${escapeHtml(href(variant, "/members"))}">Look up another member</a></td></tr>
</table>`,
  );
}

export function subAccountForm(
  variant: Variant,
  member: Member,
  input: { product?: string; nickname?: string; messages?: string[] },
): string {
  const messages = input.messages ?? [];
  const product = input.product ?? "";
  const nickname = input.nickname ?? "";
  const options = products
    .map((item) => {
      const selected = item.value === product ? " selected" : "";
      return `<option value="${item.value}"${selected}>${escapeHtml(item.label)}</option>`;
    })
    .join("");
  return chrome(
    variant,
    `<form method="post" action="${escapeHtml(href(variant, `/members/${member.memberNumber}/sub-account`))}">
  <table>
    <tr><th colspan="2">Open sub-account</th></tr>
    ${errorRow(messages)}
    <tr><td class="label">Name</td><td>${escapeHtml(member.name)}</td></tr>
    <tr><td class="label">${escapeHtml(variant.memberFieldLabel)}</td><td>${escapeHtml(member.memberNumber)}</td></tr>
    <tr>
      <td class="label">Product</td>
      <td>
        <select name="product" aria-label="Product">
          <option value="">Select a product</option>
          ${options}
        </select>
      </td>
    </tr>
    <tr>
      <td class="label">Nickname</td>
      <td><input name="nickname" aria-label="Nickname" autocomplete="off" value="${escapeHtml(nickname)}"></td>
    </tr>
    <tr><td colspan="2"><button type="submit">Continue</button></td></tr>
  </table>
</form>`,
  );
}

export function confirmationPage(
  variant: Variant,
  member: Member,
  input: { product: string; productLabel: string; nickname: string },
): string {
  const action = href(variant, `/members/${member.memberNumber}/sub-account/confirmation`);
  return chrome(
    variant,
    `<table>
  <tr><th colspan="2">Confirmation</th></tr>
  <tr><td class="label">Name</td><td>${escapeHtml(member.name)}</td></tr>
  <tr><td class="label">${escapeHtml(variant.memberFieldLabel)}</td><td>${escapeHtml(member.memberNumber)}</td></tr>
  <tr><td class="label">Product</td><td>${escapeHtml(input.productLabel)}</td></tr>
  <tr><td class="label">Nickname</td><td>${escapeHtml(input.nickname)}</td></tr>
  <tr><td class="label">Status</td><td>Ready for review. Nothing has been submitted.</td></tr>
  <tr><td colspan="2">
    <form method="post" action="${escapeHtml(action)}">
      <input type="hidden" name="product" value="${escapeHtml(input.product)}">
      <input type="hidden" name="nickname" value="${escapeHtml(input.nickname)}">
      <button type="submit">Submit</button>
    </form>
  </td></tr>
  <tr><td colspan="2"><a href="${escapeHtml(href(variant, `/members/${member.memberNumber}`))}">Back to member</a></td></tr>
</table>`,
  );
}

export function submittedPage(
  variant: Variant,
  member: Member,
  input: { productLabel: string; nickname: string },
): string {
  return chrome(
    variant,
    `<table>
  <tr><th colspan="2">Sub-account submitted</th></tr>
  <tr><td class="label">Name</td><td>${escapeHtml(member.name)}</td></tr>
  <tr><td class="label">${escapeHtml(variant.memberFieldLabel)}</td><td>${escapeHtml(member.memberNumber)}</td></tr>
  <tr><td class="label">Product</td><td>${escapeHtml(input.productLabel)}</td></tr>
  <tr><td class="label">Nickname</td><td>${escapeHtml(input.nickname)}</td></tr>
  <tr><td class="label">Status</td><td>Sub-account submitted.</td></tr>
</table>`,
  );
}

export function notFoundPage(variant: Variant | undefined): string {
  const body = `<table><tr><td class="error">Page not found.</td></tr></table>`;
  if (!variant) return documentPage("Page not found", body);
  return chrome(variant, body);
}
