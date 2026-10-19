export interface FallbackAddressSelectionInput {
  searchQuery: string;
  resultAddress: string;
  resultHouseNumber?: string;
  currentSpecificDetail: string;
}

export interface FallbackAddressSelection {
  mapAddress: string;
  specificDetail: string;
}

function normalizeForComparison(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("vi-VN")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function cleanVietnameseWard(wardName: string): string {
  if (!wardName) return "";
  const trimmed = wardName.trim();
  if (/^(khu\s*phố|tổ\s*dân\s*phố|tổ|quarter|block|group)\b/i.test(trimmed)) {
    return "";
  }
  if (/^(phường|xã|thị\s*trấn)\b/i.test(trimmed)) return trimmed;
  if (/^ward\s+/i.test(trimmed)) {
    return `Phường ${trimmed.replace(/^ward\s+/i, "")}`;
  }
  if (/^commune\s+/i.test(trimmed)) {
    return `Xã ${trimmed.replace(/^commune\s+/i, "")}`;
  }
  if (/^town\s+/i.test(trimmed)) {
    return `Thị trấn ${trimmed.replace(/^town\s+/i, "")}`;
  }
  if (/^(quận|huyện|district)\b/i.test(trimmed)) return "";
  if (/^(khu\s*phố|tổ\s*\d+|ấp\b|thôn\b|xóm\b)/i.test(trimmed)) {
    return trimmed;
  }
  return `Phường ${trimmed}`;
}

function cleanVietnameseCity(cityName: string): string {
  if (!cityName) return "";
  const trimmed = cityName.trim();
  if (
    /^(thành\s*phố\s*hồ\s*chí\s*minh|tp\.?\s*hồ\s*chí\s*minh|tp\.?\s*hcm|hồ\s*chí\s*minh|ho\s*chi\s*minh\s*city|ho\s*chi\s*minh|saigon|sài\s*gòn)$/i.test(
      trimmed,
    )
  ) {
    return "TP. Hồ Chí Minh";
  }
  if (/^(hà\s*nội|ha\s*noi)$/i.test(trimmed)) return "Hà Nội";
  if (/^(đà\s*nẵng|da\s*nang)$/i.test(trimmed)) return "TP. Đà Nẵng";
  if (/^(hải\s*phòng|hai\s*phong)$/i.test(trimmed)) return "TP. Hải Phòng";
  if (/^(cần\s*thơ|can\s*tho)$/i.test(trimmed)) return "TP. Cần Thơ";
  return trimmed.replace(/,\s*(Việt Nam|Vietnam)$/i, "");
}

export function formatTwoTierVietnameseAddress(
  rawAddress: string,
  fallbackStreet?: string,
): string {
  if (!rawAddress) return "";

  let cleaned = rawAddress.replace(/,\s*(Việt Nam|Vietnam)$/i, "").trim();
  cleaned = cleaned
    .replace(
      /,\s*(Khu\s*phố|Quarter|Tổ\s*dân\s*phố|Tổ|Block|Group)\s*[\w\d/\-]+/gi,
      "",
    )
    .replace(
      /^(Khu\s*phố|Quarter|Tổ\s*dân\s*phố|Tổ|Block|Group)\s*[\w\d/\-]+,\s*/gi,
      "",
    )
    .replace(
      /,\s*(Thành\s*phố\s*Hồ\s*Chí\s*Minh|TP\.?\s*Hồ\s*Chí\s*Minh|TP\.?\s*HCM|Ho\s*Chi\s*Minh\s*City|Ho\s*Chi\s*Minh|Sài\s*Gòn|Saigon)$/i,
      ", TP. Hồ Chí Minh",
    )
    .replace(/,\s*(Hà\s*nội|Ha\s*noi)$/i, ", Hà Nội")
    .replace(/,\s*(Đà\s*nẵng|Da\s*nang)$/i, ", TP. Đà Nẵng")
    .replace(/,\s*(Hải\s*phòng|Hai\s*phong)$/i, ", TP. Hải Phòng")
    .replace(/,\s*(Cần\s*thơ|Can\s*tho)$/i, ", TP. Cần Thơ");

  const parts = cleaned.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return rawAddress;
  if (parts.length === 1) return parts[0];

  const city = cleanVietnameseCity(parts[parts.length - 1]);
  const remaining = parts.slice(0, parts.length - 1);
  if (remaining.length === 1) return `${remaining[0]}, ${city}`;

  const street = fallbackStreet || remaining[0];
  const middleParts = remaining.filter(
    (part) => part !== street && !street.includes(part),
  );
  const explicitWard = middleParts.find((part) =>
    /^(phường|xã|thị\s*trấn|ward|commune|town)\b/i.test(part),
  );
  let wardPart = explicitWard ? cleanVietnameseWard(explicitWard) : "";

  if (!wardPart) {
    const nonDistrict = middleParts.find(
      (part) =>
        !/^(quận|huyện|district)\b/i.test(part) &&
        !/^(quận|huyện)\s*\d+$/i.test(part) &&
        !/^(khu\s*phố|tổ\s*\d+|ấp\b|thôn\b|xóm\b)/i.test(part) &&
        !/^(bình\s*tân|bình\s*thạnh|gò\s*vấp|phú\s*nhuận|tân\s*bình|tân\s*phú|thủ\s*đức|bình\s*chánh|cần\s*giờ|củ\s*chi|hóc\s*môn|nhà\s*bè)$/i.test(
          part,
        ),
    );
    wardPart = nonDistrict
      ? cleanVietnameseWard(nonDistrict)
      : middleParts[0] || "";
  }

  return [street, wardPart, city].filter(Boolean).join(", ");
}

export function resolveFallbackAddressSelection({
  searchQuery,
  resultAddress,
  resultHouseNumber,
  currentSpecificDetail,
}: FallbackAddressSelectionInput): FallbackAddressSelection {
  const firstQueryPart = searchQuery.split(",", 1)[0]?.trim() || "";
  const detailMatch = firstQueryPart.match(
    /^(?:(?:số|hẻm|ngõ|ngách|kiệt)\s*)?(\d+[\p{L}\d./-]*)\s+(.+)$/iu,
  );
  const requestedDetail = detailMatch?.[1] || "";
  const requestedStreet = detailMatch?.[2]?.replace(/^đường\s+/iu, "").trim() || "";
  const resultContainsStreet =
    requestedStreet &&
    normalizeForComparison(resultAddress).includes(
      normalizeForComparison(requestedStreet),
    );
  const addressWithRequestedStreet =
    requestedStreet && !resultContainsStreet
      ? `${requestedStreet}, ${resultAddress}`
      : resultAddress;

  return {
    mapAddress: formatTwoTierVietnameseAddress(addressWithRequestedStreet),
    specificDetail:
      currentSpecificDetail || requestedDetail || resultHouseNumber || "",
  };
}
