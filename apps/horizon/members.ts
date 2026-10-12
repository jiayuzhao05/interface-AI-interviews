export type Member = {
  memberNumber: string;
  name: string;
  savingsBalanceCents: number;
  shareDraftBalanceCents: number;
  status: "Open";
};

export const members: readonly Member[] = [
  {
    memberNumber: "10001",
    name: "Ada Okonkwo",
    savingsBalanceCents: 428015,
    shareDraftBalanceCents: 25000,
    status: "Open",
  },
  {
    memberNumber: "10002",
    name: "Luis Ortega",
    savingsBalanceCents: 91000,
    shareDraftBalanceCents: 12050,
    status: "Open",
  },
  {
    memberNumber: "10003",
    name: "Mina Chen",
    savingsBalanceCents: 1_524_033,
    shareDraftBalanceCents: 0,
    status: "Open",
  },
];

export function findMember(memberNumber: string): Member | undefined {
  return members.find((member) => member.memberNumber === memberNumber);
}

export function formatMoney(cents: number): string {
  const dollars = Math.floor(cents / 100);
  const remainder = cents % 100;
  const grouped = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `$${grouped}.${String(remainder).padStart(2, "0")}`;
}
