import {
  generateAddressSearchCandidates,
  geocodeAddress,
} from "./geocoding.helper";

describe("Geocoding Helper (OpenStreetMap / Photon)", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it("returns null for an empty or non-string address", async () => {
    expect(await geocodeAddress("")).toBeNull();
    expect(await geocodeAddress("   ")).toBeNull();
    expect(await geocodeAddress(null as any)).toBeNull();
    expect(await geocodeAddress(undefined as any)).toBeNull();
  });

  it("generates only full and street-level Vietnamese candidates", () => {
    expect(
      generateAddressSearchCandidates(
        "  38/14/14 Ao Đôi, phường Bình Trị Đông A, Bình Tân, TP.HCM  ",
      ),
    ).toEqual([
      "38/14/14 Ao Đôi, phường Bình Trị Đông A, Bình Tân, TP.HCM, Việt Nam",
      "Ao Đôi, phường Bình Trị Đông A, Bình Tân, TP.HCM, Việt Nam",
    ]);

    expect(generateAddressSearchCandidates("Quận 1, Việt Nam")).toEqual([
      "Quận 1, Việt Nam",
    ]);
  });

  it("resolves coordinates via Photon and restricts the query to Vietnam", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        features: [
          {
            properties: { name: "Quận 1" },
            geometry: {
              type: "Point",
              coordinates: [106.7008, 10.7769],
            },
          },
        ],
      }),
    });

    const coordinates = await geocodeAddress(
      "Quận 1, Thành phố Hồ Chí Minh - photon test",
    );

    expect(coordinates).toMatchObject({
      latitude: 10.7769,
      longitude: 106.7008,
      provider: "photon",
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const requestedUrl = new URL(
      (global.fetch as jest.Mock).mock.calls[0][0] as string,
    );
    expect(requestedUrl.searchParams.get("countrycode")).toBe("VN");
    expect(requestedUrl.searchParams.get("lang")).toBeNull();
    expect(requestedUrl.searchParams.get("q")).toContain("Việt Nam");
  });

  it("rejects a fuzzy result on another street", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        features: [
          {
            properties: {
              name: "Hẻm 355 Mã Lò",
              district: "Bình Trị Đông",
            },
            geometry: { coordinates: [106.603, 10.77] },
          },
          {
            properties: {
              name: "Hẻm 38/14 Ao Đôi",
              district: "Bình Trị Đông",
            },
            geometry: { coordinates: [106.5989277, 10.7758667] },
          },
        ],
      }),
    });

    const coordinates = await geocodeAddress(
      "38/14/14 Ao Đôi, phường Bình Trị Đông, Thành phố Hồ Chí Minh",
    );

    expect(coordinates).toMatchObject({
      latitude: 10.7758667,
      longitude: 106.5989277,
      matchedAddress: "Hẻm 38/14 Ao Đôi, Bình Trị Đông",
      precision: "alley",
      provider: "photon",
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("still validates the street after removing the house number", async () => {
    global.fetch = jest.fn().mockImplementation((input: string) => {
      const isPhoton = new URL(input).hostname === "photon.komoot.io";
      return Promise.resolve({
        ok: true,
        json: jest.fn().mockResolvedValue(
          isPhoton
            ? {
                features: [
                  {
                    properties: { name: "Hẻm 355 Mã Lò" },
                    geometry: { coordinates: [106.603, 10.77] },
                  },
                ],
              }
            : [
                {
                  lat: "10.77",
                  lon: "106.603",
                  display_name: "Hẻm 355 Mã Lò, Bình Trị Đông",
                },
              ],
        ),
      });
    });

    const result = await geocodeAddress(
      "99/1 Ao Đôi, phường Bình Trị Đông, Thành phố Hồ Chí Minh",
    );

    expect(result).toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(4);
  });

  it("caches normalized addresses without another network request", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        features: [
          {
            properties: { name: "Hồ Hoàn Kiếm cache test" },
            geometry: { coordinates: [105.8542, 21.0285] },
          },
        ],
      }),
    });

    const first = await geocodeAddress("Hồ Hoàn Kiếm cache test");
    const second = await geocodeAddress("  hồ hoàn kiếm   cache test  ");

    expect(second).toEqual(first);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent requests for the same address", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        features: [
          {
            properties: { name: "Đà Nẵng concurrent test" },
            geometry: { coordinates: [108.2022, 16.0544] },
          },
        ],
      }),
    });

    const [first, second] = await Promise.all([
      geocodeAddress("Đà Nẵng concurrent test"),
      geocodeAddress("Đà Nẵng concurrent test"),
    ]);

    expect(second).toEqual(first);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("falls back to Nominatim when Photon fails", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue([
          {
            lat: "21.0285",
            lon: "105.8542",
            display_name: "Hoàn Kiếm fallback test, Hà Nội",
            addresstype: "district",
          },
        ]),
      });

    const coordinates = await geocodeAddress("Hoàn Kiếm fallback test");

    expect(coordinates).toMatchObject({
      latitude: 21.0285,
      longitude: 105.8542,
      provider: "nominatim",
    });
    expect(global.fetch).toHaveBeenCalledTimes(2);

    const requestedUrl = new URL(
      (global.fetch as jest.Mock).mock.calls[1][0] as string,
    );
    expect(requestedUrl.hostname).toBe("nominatim.openstreetmap.org");
    expect(requestedUrl.searchParams.get("countrycodes")).toBe("vn");
  });

  it("rejects malformed or out-of-range coordinates", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          features: [{ geometry: { coordinates: [106, Infinity] } }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue([{ lat: "10abc", lon: "106" }]),
      });

    expect(await geocodeAddress("Invalid coordinate test")).toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("returns null without throwing when both providers fail", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("Network offline"));

    await expect(geocodeAddress("Network exception test")).resolves.toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
