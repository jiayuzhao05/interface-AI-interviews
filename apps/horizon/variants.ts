export type Variant = {
  id: "base" | "variant";
  prefix: "" | "/cu";
  institution: string;
  memberFieldLabel: string;
  /** Variant blocks the lookup form until the branch notice is dismissed. */
  blocksLookupUntilNotice: boolean;
};

export const variants = {
  base: {
    id: "base",
    prefix: "",
    institution: "Horizon Credit Union",
    memberFieldLabel: "Member number",
    blocksLookupUntilNotice: false,
  },
  variant: {
    id: "variant",
    prefix: "/cu",
    institution: "Northline Credit Union",
    memberFieldLabel: "Account ID",
    blocksLookupUntilNotice: true,
  },
} as const satisfies Record<Variant["id"], Variant>;

const PRODUCT_NAME = "Horizon Core";

export function productName(): string {
  return PRODUCT_NAME;
}

export function matchVariant(pathname: string): { variant: Variant; rest: string } {
  if (pathname === "/cu" || pathname.startsWith("/cu/")) {
    const rest = pathname.slice("/cu".length) || "/";
    return { variant: variants.variant, rest };
  }
  return { variant: variants.base, rest: pathname };
}

export function href(variant: Variant, path: string): string {
  return `${variant.prefix}${path}`;
}
