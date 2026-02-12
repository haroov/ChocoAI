type GoogleAddressComponent = {
  long_name?: string;
  short_name?: string;
  types?: string[];
};

type GoogleGeometryLocation = {
  lat?: number;
  lng?: number;
};

type GooglePlusCode = {
  global_code?: string;
  compound_code?: string;
};

type GoogleGeocodeResult = {
  formatted_address?: string;
  place_id?: string;
  address_components?: GoogleAddressComponent[];
  geometry?: { location?: GoogleGeometryLocation };
  plus_code?: GooglePlusCode;
};

type GoogleGeocodeResponse = {
  status?: string;
  error_message?: string;
  results?: GoogleGeocodeResult[];
  plus_code?: GooglePlusCode;
};

type GoogleFindPlaceCandidate = {
  place_id?: string;
};

type GoogleFindPlaceResponse = {
  status?: string;
  error_message?: string;
  candidates?: GoogleFindPlaceCandidate[];
};

type GooglePlaceDetailsResult = {
  name?: string;
  formatted_address?: string;
  place_id?: string;
  address_components?: GoogleAddressComponent[];
  geometry?: { location?: GoogleGeometryLocation };
  plus_code?: GooglePlusCode;
};

type GooglePlaceDetailsResponse = {
  status?: string;
  error_message?: string;
  result?: GooglePlaceDetailsResult;
};

export type ResolvedBusinessAddress = {
  city?: string;
  street?: string;
  houseNumber?: string;
  zip?: string;
  geoLat?: number;
  geoLng?: number;
  googleFormattedAddress?: string;
  googlePlaceId?: string;
  googlePlaceName?: string;
  googlePlusCodeGlobal?: string;
  googlePlusCodeCompound?: string;
  googleSource: 'geocoding' | 'places';
};

function parsePlusCode(pc?: GooglePlusCode | null): { global?: string; compound?: string } {
  const global = String(pc?.global_code || '').trim();
  const compound = String(pc?.compound_code || '').trim();
  return {
    global: global || undefined,
    compound: compound || undefined,
  };
}

function getGoogleApiKey(): string {
  return String(process.env.GOOGLE_MAPS_API_KEY || '').trim();
}

function byType(components: GoogleAddressComponent[] | undefined, type: string): GoogleAddressComponent | undefined {
  if (!Array.isArray(components)) return undefined;
  return components.find((c) => Array.isArray(c.types) && c.types.includes(type));
}

function parseGoogleComponents(components: GoogleAddressComponent[] | undefined): {
  city?: string;
  street?: string;
  houseNumber?: string;
  zip?: string;
} {
  const streetNumber = byType(components, 'street_number')?.long_name;
  const route = byType(components, 'route')?.long_name;
  const locality = byType(components, 'locality')?.long_name
    || byType(components, 'administrative_area_level_2')?.long_name
    || byType(components, 'administrative_area_level_1')?.long_name;
  const postal = byType(components, 'postal_code')?.long_name;

  return {
    city: locality || undefined,
    street: route || undefined,
    houseNumber: streetNumber || undefined,
    zip: postal || undefined,
  };
}

export function buildBusinessFullAddress(parts: {
  city?: string;
  street?: string;
  houseNumber?: string;
}): string {
  const city = String(parts.city || '').trim();
  const street = String(parts.street || '').trim();
  const house = String(parts.houseNumber || '').trim();
  if (!city && !street && !house) return '';
  const streetPart = [street, house].filter(Boolean).join(' ').trim();
  return [streetPart, city].filter(Boolean).join(', ').trim();
}

async function geocode(query: string, apiKey: string): Promise<GoogleGeocodeResult | null> {
  const address = String(query || '').trim();
  if (!address) return null;

  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('address', address);
  url.searchParams.set('region', 'il');
  url.searchParams.set('language', 'he');
  url.searchParams.set('key', apiKey);

  const res = await fetch(url.toString(), { method: 'GET' });
  if (!res.ok) return null;
  const data = await res.json() as GoogleGeocodeResponse;
  const first = data?.results?.[0];
  return first || null;
}

async function findPlaceIdFromText(query: string, apiKey: string): Promise<string> {
  const input = String(query || '').trim();
  if (!input) return '';

  const url = new URL('https://maps.googleapis.com/maps/api/place/findplacefromtext/json');
  url.searchParams.set('input', input);
  url.searchParams.set('inputtype', 'textquery');
  url.searchParams.set('fields', 'place_id');
  url.searchParams.set('language', 'he');
  url.searchParams.set('key', apiKey);

  const res = await fetch(url.toString(), { method: 'GET' });
  if (!res.ok) return '';
  const data = await res.json() as GoogleFindPlaceResponse;
  return String(data?.candidates?.[0]?.place_id || '').trim();
}

async function placeDetails(placeId: string, apiKey: string): Promise<GooglePlaceDetailsResult | null> {
  const id = String(placeId || '').trim();
  if (!id) return null;

  const url = new URL('https://maps.googleapis.com/maps/api/place/details/json');
  url.searchParams.set('place_id', id);
  url.searchParams.set('fields', 'place_id,name,formatted_address,address_component,geometry,plus_code');
  url.searchParams.set('language', 'he');
  url.searchParams.set('key', apiKey);

  const res = await fetch(url.toString(), { method: 'GET' });
  if (!res.ok) return null;
  const data = await res.json() as GooglePlaceDetailsResponse;
  return data?.result || null;
}

export type ResolveBusinessAddressDiagnostics = {
  apiKeyPresent: boolean;
  requests: Array<{
    kind: 'geocode' | 'places_find' | 'places_details';
    url: string;
    method: 'GET';
  }>;
  geocode: {
    httpOk: boolean;
    status: string;
    errorMessage?: string;
  };
  places: {
    attempted: boolean;
    findPlace: {
      httpOk: boolean;
      status: string;
      errorMessage?: string;
    };
    details: {
      httpOk: boolean;
      status: string;
      errorMessage?: string;
    };
  };
};

function maskGoogleKeyInUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.searchParams.has('key')) u.searchParams.set('key', '***');
    return u.toString();
  } catch {
    return String(url || '');
  }
}

async function geocodeWithDiagnostics(query: string, apiKey: string): Promise<{
  first: GoogleGeocodeResult | null;
  diagnostics: ResolveBusinessAddressDiagnostics['geocode'];
  requestUrl: string;
}> {
  const address = String(query || '').trim();
  if (!address) {
    return { first: null, diagnostics: { httpOk: true, status: 'EMPTY_QUERY' }, requestUrl: '' };
  }

  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('address', address);
  url.searchParams.set('region', 'il');
  url.searchParams.set('language', 'he');
  url.searchParams.set('key', apiKey);

  try {
    const res = await fetch(url.toString(), { method: 'GET' });
    const httpOk = Boolean(res.ok);
    if (!res.ok) return { first: null, diagnostics: { httpOk, status: `HTTP_${res.status}` }, requestUrl: url.toString() };
    const data = await res.json() as GoogleGeocodeResponse;
    const status = String(data?.status || '').trim() || 'UNKNOWN';
    const errorMessage = String(data?.error_message || '').trim() || undefined;
    const first = data?.results?.[0] || null;
    return { first, diagnostics: { httpOk, status, ...(errorMessage ? { errorMessage } : {}) }, requestUrl: url.toString() };
  } catch (e: any) {
    return {
      first: null,
      diagnostics: {
        httpOk: false,
        status: 'FETCH_ERROR',
        errorMessage: String(e?.message || '').trim() || undefined,
      },
      requestUrl: url.toString(),
    };
  }
}

async function findPlaceIdFromTextWithDiagnostics(query: string, apiKey: string): Promise<{
  placeId: string;
  diagnostics: ResolveBusinessAddressDiagnostics['places']['findPlace'];
  requestUrl: string;
}> {
  const input = String(query || '').trim();
  if (!input) {
    return { placeId: '', diagnostics: { httpOk: true, status: 'EMPTY_QUERY' }, requestUrl: '' };
  }

  const url = new URL('https://maps.googleapis.com/maps/api/place/findplacefromtext/json');
  url.searchParams.set('input', input);
  url.searchParams.set('inputtype', 'textquery');
  url.searchParams.set('fields', 'place_id');
  url.searchParams.set('language', 'he');
  url.searchParams.set('key', apiKey);

  try {
    const res = await fetch(url.toString(), { method: 'GET' });
    const httpOk = Boolean(res.ok);
    if (!res.ok) return { placeId: '', diagnostics: { httpOk, status: `HTTP_${res.status}` }, requestUrl: url.toString() };
    const data = await res.json() as GoogleFindPlaceResponse;
    const status = String(data?.status || '').trim() || 'UNKNOWN';
    const errorMessage = String(data?.error_message || '').trim() || undefined;
    const placeId = String(data?.candidates?.[0]?.place_id || '').trim();
    return { placeId, diagnostics: { httpOk, status, ...(errorMessage ? { errorMessage } : {}) }, requestUrl: url.toString() };
  } catch (e: any) {
    return {
      placeId: '',
      diagnostics: {
        httpOk: false,
        status: 'FETCH_ERROR',
        errorMessage: String(e?.message || '').trim() || undefined,
      },
      requestUrl: url.toString(),
    };
  }
}

async function placeDetailsWithDiagnostics(placeId: string, apiKey: string): Promise<{
  result: GooglePlaceDetailsResult | null;
  diagnostics: ResolveBusinessAddressDiagnostics['places']['details'];
  requestUrl: string;
}> {
  const id = String(placeId || '').trim();
  if (!id) {
    return { result: null, diagnostics: { httpOk: true, status: 'EMPTY_PLACE_ID' }, requestUrl: '' };
  }

  const url = new URL('https://maps.googleapis.com/maps/api/place/details/json');
  url.searchParams.set('place_id', id);
  url.searchParams.set('fields', 'place_id,name,formatted_address,address_component,geometry');
  url.searchParams.set('language', 'he');
  url.searchParams.set('key', apiKey);

  try {
    const res = await fetch(url.toString(), { method: 'GET' });
    const httpOk = Boolean(res.ok);
    if (!res.ok) return { result: null, diagnostics: { httpOk, status: `HTTP_${res.status}` }, requestUrl: url.toString() };
    const data = await res.json() as GooglePlaceDetailsResponse;
    const status = String(data?.status || '').trim() || 'UNKNOWN';
    const errorMessage = String(data?.error_message || '').trim() || undefined;
    const result = data?.result || null;
    return { result, diagnostics: { httpOk, status, ...(errorMessage ? { errorMessage } : {}) }, requestUrl: url.toString() };
  } catch (e: any) {
    return {
      result: null,
      diagnostics: {
        httpOk: false,
        status: 'FETCH_ERROR',
        errorMessage: String(e?.message || '').trim() || undefined,
      },
      requestUrl: url.toString(),
    };
  }
}

export async function resolveBusinessAddressFromGoogleWithDiagnostics(params: {
  query: string;
  fallbackToPlacesWhenZipMissing?: boolean;
}): Promise<{
  resolved: ResolvedBusinessAddress | null;
  diagnostics: ResolveBusinessAddressDiagnostics;
}> {
  const apiKey = getGoogleApiKey();
  const apiKeyPresent = Boolean(apiKey);
  const baseDiagnostics: ResolveBusinessAddressDiagnostics = {
    apiKeyPresent,
    requests: [],
    geocode: { httpOk: true, status: apiKeyPresent ? 'NOT_STARTED' : 'NO_API_KEY' },
    places: {
      attempted: false,
      findPlace: { httpOk: true, status: 'NOT_STARTED' },
      details: { httpOk: true, status: 'NOT_STARTED' },
    },
  };
  if (!apiKeyPresent) return { resolved: null, diagnostics: baseDiagnostics };

  const query = String(params.query || '').trim();
  if (!query) {
    return {
      resolved: null,
      diagnostics: {
        ...baseDiagnostics,
        geocode: { httpOk: true, status: 'EMPTY_QUERY' },
      },
    };
  }

  // Geocoding first
  const { first: geo, diagnostics: geocodeDiag, requestUrl: geocodeUrl } = await geocodeWithDiagnostics(query, apiKey);
  const diagnostics: ResolveBusinessAddressDiagnostics = { ...baseDiagnostics, geocode: geocodeDiag };
  if (geocodeUrl) diagnostics.requests.push({ kind: 'geocode', url: maskGoogleKeyInUrl(geocodeUrl), method: 'GET' });

  if (geo) {
    const comps = parseGoogleComponents(geo.address_components);
    const lat = geo.geometry?.location?.lat;
    const lng = geo.geometry?.location?.lng;
    const plus = parsePlusCode(geo.plus_code);

    const resolvedFromGeocode: ResolvedBusinessAddress = {
      ...comps,
      geoLat: typeof lat === 'number' ? lat : undefined,
      geoLng: typeof lng === 'number' ? lng : undefined,
      googleFormattedAddress: geo.formatted_address || undefined,
      googlePlaceId: geo.place_id || undefined,
      googlePlusCodeGlobal: plus.global,
      googlePlusCodeCompound: plus.compound,
      googleSource: 'geocoding',
    };

    const shouldFallback = (params.fallbackToPlacesWhenZipMissing ?? true) && (!resolvedFromGeocode.zip || !resolvedFromGeocode.houseNumber);
    if (!shouldFallback) return { resolved: resolvedFromGeocode, diagnostics };

    diagnostics.places.attempted = true;
    // Prefer geocode place_id when available (saves one request)
    const placeId = String(geo.place_id || '').trim();
    let pid = placeId;
    if (!pid) {
      const fp = await findPlaceIdFromTextWithDiagnostics(query, apiKey);
      pid = fp.placeId;
      diagnostics.places.findPlace = fp.diagnostics;
      if (fp.requestUrl) diagnostics.requests.push({ kind: 'places_find', url: maskGoogleKeyInUrl(fp.requestUrl), method: 'GET' });
    } else {
      diagnostics.places.findPlace = { httpOk: true, status: 'SKIPPED_USED_GEOCODE_PLACE_ID' };
    }
    if (!pid) return { resolved: resolvedFromGeocode, diagnostics };

    const det = await placeDetailsWithDiagnostics(pid, apiKey);
    diagnostics.places.details = det.diagnostics;
    if (det.requestUrl) diagnostics.requests.push({ kind: 'places_details', url: maskGoogleKeyInUrl(det.requestUrl), method: 'GET' });
    const details = det.result;
    if (!details) return { resolved: resolvedFromGeocode, diagnostics };

    const placeComps = parseGoogleComponents(details.address_components);
    const plat = details.geometry?.location?.lat;
    const plng = details.geometry?.location?.lng;
    const pplus = parsePlusCode(details.plus_code);

    return {
      resolved: {
        ...resolvedFromGeocode,
        ...placeComps,
        geoLat: typeof plat === 'number' ? plat : resolvedFromGeocode.geoLat,
        geoLng: typeof plng === 'number' ? plng : resolvedFromGeocode.geoLng,
        googleFormattedAddress: details.formatted_address || resolvedFromGeocode.googleFormattedAddress,
        googlePlaceId: details.place_id || resolvedFromGeocode.googlePlaceId,
        googlePlaceName: details.name || undefined,
        googlePlusCodeGlobal: pplus.global || resolvedFromGeocode.googlePlusCodeGlobal,
        googlePlusCodeCompound: pplus.compound || resolvedFromGeocode.googlePlusCodeCompound,
        googleSource: 'places',
      },
      diagnostics,
    };
  }

  // Geocoding returned nothing -> try Places as last resort
  diagnostics.places.attempted = true;
  const fp = await findPlaceIdFromTextWithDiagnostics(query, apiKey);
  diagnostics.places.findPlace = fp.diagnostics;
  if (fp.requestUrl) diagnostics.requests.push({ kind: 'places_find', url: maskGoogleKeyInUrl(fp.requestUrl), method: 'GET' });
  const pid = fp.placeId;
  if (!pid) return { resolved: null, diagnostics };

  const det = await placeDetailsWithDiagnostics(pid, apiKey);
  diagnostics.places.details = det.diagnostics;
  if (det.requestUrl) diagnostics.requests.push({ kind: 'places_details', url: maskGoogleKeyInUrl(det.requestUrl), method: 'GET' });
  const details = det.result;
  if (!details) return { resolved: null, diagnostics };

  const comps = parseGoogleComponents(details.address_components);
  const lat = details.geometry?.location?.lat;
  const lng = details.geometry?.location?.lng;
  const plus = parsePlusCode(details.plus_code);

  return {
    resolved: {
      ...comps,
      geoLat: typeof lat === 'number' ? lat : undefined,
      geoLng: typeof lng === 'number' ? lng : undefined,
      googleFormattedAddress: details.formatted_address || undefined,
      googlePlaceId: details.place_id || undefined,
      googlePlaceName: details.name || undefined,
      googlePlusCodeGlobal: plus.global,
      googlePlusCodeCompound: plus.compound,
      googleSource: 'places',
    },
    diagnostics,
  };
}

/**
 * Resolve an Israeli business address from free text using:
 * 1) Geocoding (always first)
 * 2) Places (fallback when Geocoding doesn't provide ZIP)
 */
export async function resolveBusinessAddressFromGoogle(params: {
  query: string;
  fallbackToPlacesWhenZipMissing?: boolean;
}): Promise<ResolvedBusinessAddress | null> {
  const apiKey = getGoogleApiKey();
  if (!apiKey) return null;

  const query = String(params.query || '').trim();
  if (!query) return null;

  try {
    const geo = await geocode(query, apiKey);
    if (geo) {
      const comps = parseGoogleComponents(geo.address_components);
      const lat = geo.geometry?.location?.lat;
      const lng = geo.geometry?.location?.lng;
      const plus = parsePlusCode(geo.plus_code);

      const resolvedFromGeocode: ResolvedBusinessAddress = {
        ...comps,
        geoLat: typeof lat === 'number' ? lat : undefined,
        geoLng: typeof lng === 'number' ? lng : undefined,
        googleFormattedAddress: geo.formatted_address || undefined,
        googlePlaceId: geo.place_id || undefined,
        googlePlusCodeGlobal: plus.global,
        googlePlusCodeCompound: plus.compound,
        googleSource: 'geocoding',
      };

      const shouldFallback = (params.fallbackToPlacesWhenZipMissing ?? true) && (!resolvedFromGeocode.zip || !resolvedFromGeocode.houseNumber);
      if (!shouldFallback) return resolvedFromGeocode;

      // Prefer geocode place_id when available (saves one request)
      const pid = String(geo.place_id || '').trim() || await findPlaceIdFromText(query, apiKey);
      if (!pid) return resolvedFromGeocode;

      const details = await placeDetails(pid, apiKey);
      if (!details) return resolvedFromGeocode;

      const placeComps = parseGoogleComponents(details.address_components);
      const plat = details.geometry?.location?.lat;
      const plng = details.geometry?.location?.lng;
      const pplus = parsePlusCode(details.plus_code);

      return {
        ...resolvedFromGeocode,
        ...placeComps,
        geoLat: typeof plat === 'number' ? plat : resolvedFromGeocode.geoLat,
        geoLng: typeof plng === 'number' ? plng : resolvedFromGeocode.geoLng,
        googleFormattedAddress: details.formatted_address || resolvedFromGeocode.googleFormattedAddress,
        googlePlaceId: details.place_id || resolvedFromGeocode.googlePlaceId,
        googlePlaceName: details.name || undefined,
        googlePlusCodeGlobal: pplus.global || resolvedFromGeocode.googlePlusCodeGlobal,
        googlePlusCodeCompound: pplus.compound || resolvedFromGeocode.googlePlusCodeCompound,
        googleSource: 'places',
      };
    }

    // Geocoding returned nothing -> try Places as last resort
    const pid = await findPlaceIdFromText(query, apiKey);
    if (!pid) return null;

    const details = await placeDetails(pid, apiKey);
    if (!details) return null;

    const comps = parseGoogleComponents(details.address_components);
    const lat = details.geometry?.location?.lat;
    const lng = details.geometry?.location?.lng;
    const plus = parsePlusCode(details.plus_code);

    return {
      ...comps,
      geoLat: typeof lat === 'number' ? lat : undefined,
      geoLng: typeof lng === 'number' ? lng : undefined,
      googleFormattedAddress: details.formatted_address || undefined,
      googlePlaceId: details.place_id || undefined,
      googlePlaceName: details.name || undefined,
      googlePlusCodeGlobal: plus.global,
      googlePlusCodeCompound: plus.compound,
      googleSource: 'places',
    };
  } catch {
    return null;
  }
}

