import assert from "node:assert/strict";
import test from "node:test";
import { resolveFallbackAddressSelection } from "./map-address-selection.ts";

test("preserves a nested alley address when the provider only returns the ward", () => {
  const selection = resolveFallbackAddressSelection({
    searchQuery:
      "38/14/14 Ao Đôi, phường Bình Trị Đông, Thành phố Hồ Chí Minh",
    resultAddress: "Bình Trị Đông, TP. Hồ Chí Minh",
    currentSpecificDetail: "",
  });

  assert.deepEqual(selection, {
    mapAddress: "Ao Đôi, Phường Bình Trị Đông, TP. Hồ Chí Minh",
    specificDetail: "38/14/14",
  });
});

test("does not duplicate the street when the provider already returned it", () => {
  const selection = resolveFallbackAddressSelection({
    searchQuery:
      "38/14/14 Ao Đôi, phường Bình Trị Đông, Thành phố Hồ Chí Minh",
    resultAddress: "Ao Đôi, Bình Trị Đông, Hồ Chí Minh, Việt Nam",
    currentSpecificDetail: "",
  });

  assert.deepEqual(selection, {
    mapAddress: "Ao Đôi, Phường Bình Trị Đông, TP. Hồ Chí Minh",
    specificDetail: "38/14/14",
  });
});

test("keeps a detail the user already entered", () => {
  const selection = resolveFallbackAddressSelection({
    searchQuery: "Ao Đôi, Bình Trị Đông, Thành phố Hồ Chí Minh",
    resultAddress: "Ao Đôi, Bình Trị Đông, Hồ Chí Minh",
    resultHouseNumber: "38",
    currentSpecificDetail: "Cổng màu xanh",
  });

  assert.equal(selection.specificDetail, "Cổng màu xanh");
});
