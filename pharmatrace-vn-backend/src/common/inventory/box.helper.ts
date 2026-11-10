export const AVAILABLE_BOX_STATUSES = [
  "IN_STOCK",
  "MANUFACTURED",
];

export function isBoxUnit(unitName?: string | null): boolean {
  if (!unitName) return true;
  const s = unitName.trim().toUpperCase();
  const knownKeywords = [
    "BOX",
    "BLISTER",
    "BOTTLE",
    "VIAL",
    "TUBE",
    "PACK",
    "SACHET",
    "AMPOULE",
    "PILL",
    "TABLET",
    "CAPSULE",
  ];
  return knownKeywords.some((kw) => s.includes(kw));
}

