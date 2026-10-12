import type { DiscoverRequest } from "./loop.ts";

export function lookupRequest(memberId: string, origin = "http://127.0.0.1:4173"): DiscoverRequest {
  return {
    goal: `Look up member ${memberId} and read the savings balance on the detail screen. Enter ${memberId} in the member number field and submit the lookup. Do not open a sub-account.`,
    origin,
    maxSteps: 12,
    concreteInput: memberId,
    name: "lookup_savings_balance",
    description: "Look up a member on Horizon Core and return the savings balance shown on the detail screen.",
    appId: "horizon-core",
    input: {
      name: "memberId",
      description: "Member number. On the Northline variant the same value is entered in the field labeled Account ID.",
      pattern: "^[0-9]+$",
    },
    output: {
      name: "savingsBalance",
      description: "Savings balance text shown beside Savings balance, including the dollar sign.",
      pattern: "^\\$[0-9,]+\\.[0-9]{2}$",
    },
    outcomes: [
      {
        code: "member_not_found",
        whenText: "No member matches.",
        description: "No member is on file for that number. The caller receives this outcome instead of a failed run.",
      },
    ],
  };
}
