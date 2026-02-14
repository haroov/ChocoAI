import { enrichBusinessAddressInPlace } from '../../lib/flowEngine/businessAddressEnrichment';

describe('enrichBusinessAddressInPlace', () => {
  test('derives business_full_address and fills missing structured fields from resolver', async () => {
    const validated: Record<string, unknown> = {
      // Typical second-step reply: user answered with a place-like token in the street field.
      business_street: 'קניון עזריאלי',
    };
    const existing: Record<string, unknown> = {
      business_city: 'עכו',
    };

    const resolveAddress = jest.fn(async () => ({
      city: 'עכו',
      street: 'דרך מנחם בגין',
      houseNumber: '132',
      zip: '6701101',
      geoLat: 32.074,
      geoLng: 34.792,
      googleFormattedAddress: 'דרך מנחם בגין 132, תל אביב-יפו, ישראל',
      googlePlaceId: 'place123',
      googlePlaceName: 'קניון עזריאלי',
      googleSource: 'places' as const,
    }));

    await enrichBusinessAddressInPlace({ validatedCollectedData: validated, existingUserData: existing, resolveAddress });

    expect(resolveAddress).toHaveBeenCalledTimes(1);
    expect(validated.business_street).toBe('דרך מנחם בגין');
    expect(validated.business_house_number).toBe('132');
    expect(validated.business_zip).toBe('6701101');
    expect(validated.business_geo_lat).toBe(32.074);
    expect(validated.business_geo_lng).toBe(34.792);
    expect(validated.business_google_formatted_address).toBe('דרך מנחם בגין 132, תל אביב-יפו, ישראל');
    expect(validated.business_google_place_id).toBe('place123');
    expect(validated.business_google_place_name).toBe('קניון עזריאלי');
    // Full address should be recomputed after normalization
    expect(validated.business_full_address).toBe('דרך מנחם בגין 132, עכו');
  });

  test('does not call resolver when zip+coords+house already exist', async () => {
    const validated: Record<string, unknown> = {
      business_city: 'עכו',
      business_street: 'הרצל',
      business_house_number: '10',
      business_zip: '1234567',
      business_geo_lat: 32.9,
      business_geo_lng: 35.1,
    };

    const existing: Record<string, unknown> = {};
    const resolveAddress = jest.fn(async () => null);

    await enrichBusinessAddressInPlace({ validatedCollectedData: validated, existingUserData: existing, resolveAddress });

    expect(resolveAddress).not.toHaveBeenCalled();
    expect(validated.business_full_address).toBe('הרצל 10, עכו');
  });

  test('does not override user-provided city/street when Google suggests a different address', async () => {
    const validated: Record<string, unknown> = {
      business_street: 'היובלים',
      business_house_number: '52',
    };
    const existing: Record<string, unknown> = {
      business_city: 'עולש',
    };

    const resolveAddress = jest.fn(async () => ({
      city: 'בארותיים',
      street: 'היובלים',
      houseNumber: '52',
      zip: '0000000',
      geoLat: 32.3,
      geoLng: 35.0,
      googleFormattedAddress: 'היובלים 52, בארותיים, ישראל',
      googlePlaceId: 'place456',
      googlePlaceName: 'Some Place',
      googleSource: 'geocoding' as const,
    }));

    await enrichBusinessAddressInPlace({ validatedCollectedData: validated, existingUserData: existing, resolveAddress });

    expect(resolveAddress).toHaveBeenCalledTimes(1);
    // Keep user's values
    expect(validated.business_city).toBeUndefined();
    expect(existing.business_city).toBe('עולש');
    expect(validated.business_full_address).toBe('היובלים 52, עולש');
    // Store suggestion separately + require confirmation
    expect(validated.business_google_suggested_city).toBe('בארותיים');
    expect(validated.business_google_suggested_full_address).toContain('בארותיים');
    expect(validated.business_address_needs_confirmation).toBe(true);
    expect(validated.business_google_match_found).toBe(false);
    expect(validated.business_google_match_status).toBe('mismatch_suggested');
    // Do not write "business_zip/coords" from suggestion before acceptance
    expect(validated.business_zip).toBeUndefined();
    expect(validated.business_geo_lat).toBeUndefined();
    expect(validated.business_google_formatted_address).toBeUndefined();
  });
});

