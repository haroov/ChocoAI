import {
  buildBusinessFullAddress,
  ResolvedBusinessAddress,
  resolveBusinessAddressFromGoogle,
  resolveBusinessAddressFromGoogleWithDiagnostics,
} from '../services/googleMaps/resolveBusinessAddress';
import { logApiCall } from '../../utils/trackApiCall';

export async function enrichBusinessAddressInPlace(params: {
  validatedCollectedData: Record<string, unknown>;
  existingUserData: Record<string, unknown>;
  conversationId?: string;
  resolveAddress?: (p: {
    query: string;
    fallbackToPlacesWhenZipMissing?: boolean;
  }) => Promise<ResolvedBusinessAddress | null>;
}): Promise<void> {
  const { validatedCollectedData, existingUserData } = params;
  const resolveAddress = params.resolveAddress || resolveBusinessAddressFromGoogle;

  const normalizeForCompare = (s: unknown): string => String(s ?? '')
    .trim()
    .replace(/[“”"׳״']/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();

  const existingCity = String((existingUserData as any)?.business_city || '').trim();
  const existingStreet = String((existingUserData as any)?.business_street || '').trim();
  const existingHouse = String((existingUserData as any)?.business_house_number || '').trim();
  const existingZip = String((existingUserData as any)?.business_zip || '').trim();
  const existingLat = (existingUserData as any)?.business_geo_lat;
  const existingLng = (existingUserData as any)?.business_geo_lng;
  const existingAddressConfirmed = (existingUserData as any)?.business_address_confirmed === true;
  const existingNeedsCorrection = String((existingUserData as any)?.business_address_needs_correction || '').trim();

  const city = String(validatedCollectedData.business_city ?? existingCity ?? '').trim();
  const street = String(validatedCollectedData.business_street ?? existingStreet ?? '').trim();
  const houseNumber = String(validatedCollectedData.business_house_number ?? existingHouse ?? '').trim();

  const zip = String(validatedCollectedData.business_zip ?? existingZip ?? '').trim();
  const latRaw = validatedCollectedData.business_geo_lat ?? existingLat;
  const lngRaw = validatedCollectedData.business_geo_lng ?? existingLng;
  const hasCoords = typeof latRaw === 'number' && typeof lngRaw === 'number';

  // Only attempt enrichment if we have at least city + street (2-step address UX).
  if (!city || !street) return;

  const initialFull = buildBusinessFullAddress({ city, street, houseNumber });
  if (initialFull) validatedCollectedData.business_full_address = initialFull;

  // If the user typed a place-like token instead of a street+number, keep it as a hint.
  // (Useful even if Places Details fails due to API restrictions.)
  try {
    const looksPlaceLike = !houseNumber && !/\d/.test(street) && /[\u0590-\u05FFA-Za-z]/.test(street);
    if (looksPlaceLike) {
      const placeQuery = `${street}, ${city}`.trim();
      if (placeQuery) validatedCollectedData.business_google_place_query = placeQuery;
    }
  } catch {
    // best-effort
  }

  const needsEnrichment = !zip || !hasCoords || !houseNumber;
  if (!needsEnrichment || !initialFull) return;

  // If the user explicitly confirmed the address even though Google can't fully validate it,
  // do not block the flow with repeated "confirm address" prompts.
  try {
    const confirmedNow = validatedCollectedData.business_address_confirmed === true;
    const userConfirmed = existingAddressConfirmed || confirmedNow;
    if (userConfirmed) {
      validatedCollectedData.business_address_needs_confirmation = false;
      validatedCollectedData.business_address_needs_correction = 'N';
    } else if (!String(validatedCollectedData.business_address_needs_correction ?? '').trim() && existingNeedsCorrection) {
      // Preserve correction state until the user submits a corrected address.
      validatedCollectedData.business_address_needs_correction = existingNeedsCorrection;
    } else if (!String(validatedCollectedData.business_address_needs_correction ?? '').trim()) {
      // Default to "no correction in progress" so ask_if logic can be simple.
      validatedCollectedData.business_address_needs_correction = 'N';
    }
  } catch {
    // best-effort
  }

  const diagnosticsEnabled = !params.resolveAddress; // keep unit-tests stable; enable diagnostics in prod
  const diag = diagnosticsEnabled
    ? await resolveBusinessAddressFromGoogleWithDiagnostics({
      query: initialFull,
      fallbackToPlacesWhenZipMissing: true,
    })
    : null;
  const resolved = diag
    ? diag.resolved
    : await resolveAddress({
      query: initialFull,
      fallbackToPlacesWhenZipMissing: true,
    });

  if (diag) {
    validatedCollectedData.business_google_api_key_present = diag.diagnostics.apiKeyPresent;
    validatedCollectedData.business_google_geocode_status = diag.diagnostics.geocode.status;
    if (diag.diagnostics.geocode.errorMessage) {
      validatedCollectedData.business_google_geocode_error_message = diag.diagnostics.geocode.errorMessage;
    }
    validatedCollectedData.business_google_places_attempted = diag.diagnostics.places.attempted;
    validatedCollectedData.business_google_places_find_status = diag.diagnostics.places.findPlace.status;
    if (diag.diagnostics.places.findPlace.errorMessage) {
      validatedCollectedData.business_google_places_find_error_message = diag.diagnostics.places.findPlace.errorMessage;
    }
    validatedCollectedData.business_google_places_details_status = diag.diagnostics.places.details.status;
    if (diag.diagnostics.places.details.errorMessage) {
      validatedCollectedData.business_google_places_details_error_message = diag.diagnostics.places.details.errorMessage;
    }

    // Log to ApiCall table so it appears under "API Log" in Conversation details.
    // Never log the API key (URLs are masked).
    try {
      const conversationId = String(params.conversationId || '').trim();
      if (!conversationId) return;
      const ok = diag.diagnostics.geocode.status === 'OK'
        && (!diag.diagnostics.places.attempted
          || (diag.diagnostics.places.findPlace.status === 'OK' && diag.diagnostics.places.details.status === 'OK'));
      await logApiCall({
        conversationId,
        provider: 'google_maps',
        operation: 'business_address_resolve',
        request: {
          query: initialFull,
          requests: diag.diagnostics.requests,
        },
        response: {
          resolved: diag.resolved,
          diagnostics: diag.diagnostics,
        },
        status: ok ? 'ok' : 'error',
      });
    } catch {
      // best-effort
    }
  }

  // If Google couldn't resolve, mark that we need user confirmation/correction (unless already confirmed).
  try {
    const userConfirmed = validatedCollectedData.business_address_confirmed === true || existingAddressConfirmed;
    if (!userConfirmed) {
      const geoStatus = String((validatedCollectedData as any).business_google_geocode_status || '').trim();
      const shouldConfirm = !geoStatus || geoStatus !== 'OK';
      if (shouldConfirm) {
        validatedCollectedData.business_address_needs_confirmation = true;
        if (!String(validatedCollectedData.business_address_needs_correction ?? '').trim()) {
          validatedCollectedData.business_address_needs_correction = existingNeedsCorrection || 'N';
        }
      }
    }
  } catch {
    // best-effort
  }

  if (!resolved) return;

  // If Google returns a *different* city/street/house than what the user provided,
  // do NOT auto-override. Store it as a suggestion and ask for confirmation.
  try {
    const userConfirmed = validatedCollectedData.business_address_confirmed === true || existingAddressConfirmed;
    const gCity = String(resolved.city || '').trim();
    const gStreet = String(resolved.street || '').trim();
    const gHouse = String(resolved.houseNumber || '').trim();

    const cityDiff = city && gCity && normalizeForCompare(city) !== normalizeForCompare(gCity);
    const streetDiff = street && gStreet && normalizeForCompare(street) !== normalizeForCompare(gStreet);
    const houseDiff = houseNumber && gHouse && normalizeForCompare(houseNumber) !== normalizeForCompare(gHouse);
    const hasSuggestion = Boolean(gCity || gStreet || gHouse || resolved.googleFormattedAddress);

    // If the user's "street" input is place-like (no house number, no digits), we allow Google to normalize it
    // into a street+house without requiring confirmation (e.g., "קניון עזריאלי" -> "דרך מנחם בגין 132").
    const userStreetLooksPlaceLike = !houseNumber && !/\d/.test(street) && /[\u0590-\u05FFA-Za-z]/.test(street);
    const shouldConsiderStreetDiff = !userStreetLooksPlaceLike;
    const shouldConsiderHouseDiff = Boolean(houseNumber);

    const isMismatch = !userConfirmed
      && hasSuggestion
      && (
        cityDiff
        || (shouldConsiderStreetDiff && streetDiff)
        || (shouldConsiderHouseDiff && houseDiff)
      );

    if (isMismatch) {
      validatedCollectedData.business_google_match_status = 'mismatch_suggested';
      if (gCity) validatedCollectedData.business_google_suggested_city = gCity;
      if (gStreet) validatedCollectedData.business_google_suggested_street = gStreet;
      if (gHouse) validatedCollectedData.business_google_suggested_house_number = gHouse;

      const suggestedFull = buildBusinessFullAddress({
        city: gCity || city,
        street: gStreet || street,
        houseNumber: gHouse || houseNumber,
      }) || String(resolved.googleFormattedAddress || '').trim();
      if (suggestedFull) validatedCollectedData.business_google_suggested_full_address = suggestedFull;

      if (resolved.zip) validatedCollectedData.business_google_suggested_zip = resolved.zip;
      if (typeof resolved.geoLat === 'number' && typeof resolved.geoLng === 'number') {
        validatedCollectedData.business_google_suggested_geo_lat = resolved.geoLat;
        validatedCollectedData.business_google_suggested_geo_lng = resolved.geoLng;
      }
      if (resolved.googleFormattedAddress) {
        validatedCollectedData.business_google_suggested_formatted_address = resolved.googleFormattedAddress;
      }
      if (resolved.googlePlaceId) validatedCollectedData.business_google_suggested_place_id = resolved.googlePlaceId;
      if (resolved.googlePlaceName) validatedCollectedData.business_google_suggested_place_name = resolved.googlePlaceName;
      if (resolved.googlePlusCodeGlobal) validatedCollectedData.business_google_suggested_plus_code_global = resolved.googlePlusCodeGlobal;
      if (resolved.googlePlusCodeCompound) validatedCollectedData.business_google_suggested_plus_code_compound = resolved.googlePlusCodeCompound;

      validatedCollectedData.business_address_needs_confirmation = true;
      validatedCollectedData.business_address_needs_correction = 'N';
      validatedCollectedData.business_google_match_found = false;

      // Keep user's original business_* fields as-is; do not write business_zip/coords from the mismatched suggestion.
      return;
    }
  } catch {
    // best-effort
  }

  // If Google could not return street+house components, treat it as "no match" for verification purposes.
  // We still allow the flow to continue if the user confirms "as-is".
  try {
    const userConfirmed = validatedCollectedData.business_address_confirmed === true || existingAddressConfirmed;
    const googleHasStreetHouse = Boolean(resolved.street && resolved.houseNumber);
    if (!userConfirmed && !googleHasStreetHouse) {
      validatedCollectedData.business_google_match_status = 'no_match_needs_confirmation';
      validatedCollectedData.business_google_match_found = false;

      // Store whatever Google returned as *suggested* (do not overwrite user values).
      if (resolved.city) validatedCollectedData.business_google_suggested_city = String(resolved.city).trim();
      if (resolved.street) validatedCollectedData.business_google_suggested_street = String(resolved.street).trim();
      if (resolved.houseNumber) validatedCollectedData.business_google_suggested_house_number = String(resolved.houseNumber).trim();
      if (resolved.zip) validatedCollectedData.business_google_suggested_zip = resolved.zip;
      if (typeof resolved.geoLat === 'number' && typeof resolved.geoLng === 'number') {
        validatedCollectedData.business_google_suggested_geo_lat = resolved.geoLat;
        validatedCollectedData.business_google_suggested_geo_lng = resolved.geoLng;
      }
      if (resolved.googleFormattedAddress) {
        validatedCollectedData.business_google_suggested_formatted_address = resolved.googleFormattedAddress;
      }
      if (resolved.googlePlaceId) validatedCollectedData.business_google_suggested_place_id = resolved.googlePlaceId;
      if (resolved.googlePlaceName) validatedCollectedData.business_google_suggested_place_name = resolved.googlePlaceName;
      if (resolved.googlePlusCodeGlobal) validatedCollectedData.business_google_suggested_plus_code_global = resolved.googlePlusCodeGlobal;
      if (resolved.googlePlusCodeCompound) validatedCollectedData.business_google_suggested_plus_code_compound = resolved.googlePlusCodeCompound;

      validatedCollectedData.business_address_needs_confirmation = true;
      validatedCollectedData.business_address_needs_correction = 'N';
      return;
    }
  } catch {
    // best-effort
  }

  // Fill missing structured parts first (and allow Places to turn a place-name into street+number).
  const effectiveHouse = String(validatedCollectedData.business_house_number ?? existingHouse ?? '').trim();
  if (!effectiveHouse && resolved.street && resolved.houseNumber) {
    validatedCollectedData.business_street = resolved.street;
    validatedCollectedData.business_house_number = resolved.houseNumber;
  } else {
    if (!String(validatedCollectedData.business_house_number || '').trim() && resolved.houseNumber) {
      validatedCollectedData.business_house_number = resolved.houseNumber;
    }
    if (!String(validatedCollectedData.business_street || '').trim() && resolved.street) {
      validatedCollectedData.business_street = resolved.street;
    }
  }
  if (!String(validatedCollectedData.business_city || '').trim() && resolved.city) {
    validatedCollectedData.business_city = resolved.city;
  }

  // Google outputs
  validatedCollectedData.business_google_match_found = true;
  validatedCollectedData.business_google_match_status = 'matched';
  if (!zip && resolved.zip) validatedCollectedData.business_zip = resolved.zip;
  if (!hasCoords && typeof resolved.geoLat === 'number' && typeof resolved.geoLng === 'number') {
    validatedCollectedData.business_geo_lat = resolved.geoLat;
    validatedCollectedData.business_geo_lng = resolved.geoLng;
  }
  if (resolved.googleFormattedAddress) validatedCollectedData.business_google_formatted_address = resolved.googleFormattedAddress;
  if (resolved.googlePlaceId) validatedCollectedData.business_google_place_id = resolved.googlePlaceId;
  if (resolved.googlePlaceName) validatedCollectedData.business_google_place_name = resolved.googlePlaceName;
  if (resolved.googlePlusCodeGlobal) validatedCollectedData.business_google_plus_code_global = resolved.googlePlusCodeGlobal;
  if (resolved.googlePlusCodeCompound) validatedCollectedData.business_google_plus_code_compound = resolved.googlePlusCodeCompound;

  // Address verification signal:
  // If Google did NOT return street+house components, we consider it "not fully verified" and ask the user to confirm/correct,
  // unless they already confirmed.
  try {
    const userConfirmed = validatedCollectedData.business_address_confirmed === true || existingAddressConfirmed;
    if (userConfirmed) {
      validatedCollectedData.business_address_needs_confirmation = false;
      validatedCollectedData.business_address_needs_correction = 'N';
    } else {
      const googleHasStreetHouse = Boolean(resolved.street && resolved.houseNumber);
      validatedCollectedData.business_address_needs_confirmation = !googleHasStreetHouse;
      if (!googleHasStreetHouse) {
        // Keep correction flag state (default N).
        if (!String(validatedCollectedData.business_address_needs_correction ?? '').trim()) {
          validatedCollectedData.business_address_needs_correction = existingNeedsCorrection || 'N';
        }
      } else {
        validatedCollectedData.business_address_needs_correction = 'N';
      }
    }
  } catch {
    // best-effort
  }

  // Recompute full address after any normalization.
  const finalCity = String(validatedCollectedData.business_city ?? city).trim();
  const finalStreet = String(validatedCollectedData.business_street ?? street).trim();
  const finalHouse = String(validatedCollectedData.business_house_number ?? houseNumber).trim();
  const finalFull = buildBusinessFullAddress({ city: finalCity, street: finalStreet, houseNumber: finalHouse });
  if (finalFull) validatedCollectedData.business_full_address = finalFull;
}
