import { resolveBusinessAddressFromGoogle } from '../../lib/services/googleMaps/resolveBusinessAddress';

function mockJsonResponse(obj: unknown) {
  return {
    ok: true,
    json: async () => obj,
  } as any;
}

describe('resolveBusinessAddressFromGoogle', () => {
  const prevKey = process.env.GOOGLE_MAPS_API_KEY;
  const prevFetch = global.fetch;

  beforeEach(() => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
  });

  afterEach(() => {
    process.env.GOOGLE_MAPS_API_KEY = prevKey;
    global.fetch = prevFetch as any;
    jest.restoreAllMocks();
  });

  test('falls back to Places when Geocoding has no ZIP', async () => {
    const fetchMock = jest.fn(async (url: any) => {
      const u = String(url || '');
      if (u.includes('maps.googleapis.com/maps/api/geocode/json')) {
        return mockJsonResponse({
          status: 'OK',
          results: [
            {
              formatted_address: 'קניון עזריאלי, עכו, ישראל',
              place_id: 'geo_place_id_1',
              geometry: { location: { lat: 32.9, lng: 35.1 } },
              plus_code: { global_code: '8G3QXXXX+XX', compound_code: 'XXXX+XX עכו, ישראל' },
              address_components: [
                { long_name: 'עכו', types: ['locality'] },
                { long_name: 'קניון עזריאלי', types: ['route'] },
                // postal_code intentionally missing
              ],
            },
          ],
        });
      }
      if (u.includes('maps.googleapis.com/maps/api/place/details/json')) {
        return mockJsonResponse({
          status: 'OK',
          result: {
            place_id: 'geo_place_id_1',
            name: 'קניון עזריאלי',
            formatted_address: 'דרך מנחם בגין 132, עכו, ישראל',
            geometry: { location: { lat: 32.901, lng: 35.101 } },
            plus_code: { global_code: '8G3QYYYY+YY', compound_code: 'YYYY+YY עכו, ישראל' },
            address_components: [
              { long_name: '132', types: ['street_number'] },
              { long_name: 'דרך מנחם בגין', types: ['route'] },
              { long_name: 'עכו', types: ['locality'] },
              { long_name: '1234567', types: ['postal_code'] },
            ],
          },
        });
      }
      throw new Error(`Unexpected URL in fetch mock: ${u}`);
    });

    global.fetch = fetchMock as any;

    const res = await resolveBusinessAddressFromGoogle({ query: 'קניון עזריאלי, עכו', fallbackToPlacesWhenZipMissing: true });
    expect(res).not.toBeNull();
    expect(res?.googleSource).toBe('places');
    expect(res?.googlePlaceId).toBe('geo_place_id_1');
    expect(res?.googlePlaceName).toBe('קניון עזריאלי');
    expect(res?.googleFormattedAddress).toBe('דרך מנחם בגין 132, עכו, ישראל');
    expect(res?.street).toBe('דרך מנחם בגין');
    expect(res?.houseNumber).toBe('132');
    expect(res?.city).toBe('עכו');
    expect(res?.zip).toBe('1234567');
    expect(res?.geoLat).toBe(32.901);
    expect(res?.geoLng).toBe(35.101);
    expect(res?.googlePlusCodeGlobal).toBe('8G3QYYYY+YY');
    expect(res?.googlePlusCodeCompound).toBe('YYYY+YY עכו, ישראל');

    // Geocode + details
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

