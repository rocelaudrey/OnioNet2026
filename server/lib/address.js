import {
  getAllBarangays, getAllMunicipalities, getAllProvinces, getAllRegions,
} from '@aivangogh/ph-address';

// Philippine addresses from the official PSGC list (PSA). The browser sends
// only codes; the server looks up the names, so stored addresses always match
// the official list.

const byName = (a, b) => a.name.localeCompare(b.name, 'en');
const regionLabel = (r) => (r.designation ? `${r.name} (${r.designation})` : r.name);

let cache;
function data() {
  if (cache) return cache;
  const regions = getAllRegions();
  const provinces = getAllProvinces();
  const provinceCodes = new Set(provinces.map((p) => p.psgcCode));
  const regionOf = (code) => `${code.slice(0, 2)}00000000`;
  // The "area" a city belongs to: its province, or its region when the region
  // has no provinces (Metro Manila).
  const areaOf = (m) => (provinceCodes.has(m.provinceCode) ? m.provinceCode : regionOf(m.psgcCode));
  const municipalities = getAllMunicipalities().map((m) => ({ ...m, area: areaOf(m) }));
  cache = {
    regions,
    provinces,
    municipalities,
    barangays: getAllBarangays(),
    region: new Map(regions.map((r) => [r.psgcCode, r])),
    province: new Map(provinces.map((p) => [p.psgcCode, p])),
    municipality: new Map(municipalities.map((m) => [m.psgcCode, m])),
    barangay: new Map(getAllBarangays().map((b) => [b.psgcCode, b])),
    regionOf,
  };
  return cache;
}

// Groupings for the browser's dropdown files (scripts/build-psgc.js).
export function areaGroups() {
  const d = data();
  const group = (rows, key) => {
    const out = {};
    for (const row of [...rows].sort(byName)) (out[row[key]] ??= []).push({ code: row.psgcCode, name: row.name });
    return out;
  };
  const muniArea = new Map(d.municipalities.map((m) => [m.psgcCode, m.area]));
  const barangaysByArea = {};
  for (const b of [...d.barangays].sort(byName)) {
    const area = muniArea.get(b.municipalCityCode);
    if (!area) continue;
    ((barangaysByArea[area] ??= {})[b.municipalCityCode] ??= []).push({ code: b.psgcCode, name: b.name });
  }
  return {
    regions: d.regions.map((r) => ({ code: r.psgcCode, name: regionLabel(r) })),
    provincesByRegion: group(d.provinces, 'regionCode'),
    municipalitiesByArea: group(d.municipalities, 'area'),
    barangaysByArea,
  };
}

const bad = (message) => Object.assign(new Error(message), { status: 400, expose: true });

// Reads { regionCode, provinceCode, municipalityCode, barangayCode, street }
// and returns the stored address with names filled in from the official list.
// Any level may be left empty, but each chosen level must sit inside the one above.
export function resolveAddress(input) {
  const d = data();
  const code = (v) => (typeof v === 'string' && /^\d{10}$/.test(v) ? v : v ? null : '');
  const regionCode = code(input?.regionCode);
  const provinceCode = code(input?.provinceCode);
  const municipalityCode = code(input?.municipalityCode);
  const barangayCode = code(input?.barangayCode);
  if ([regionCode, provinceCode, municipalityCode, barangayCode].includes(null)) throw bad('Choose the address from the lists.');
  const street = String(input?.street ?? '').trim().slice(0, 120);

  const region = regionCode ? d.region.get(regionCode) : null;
  const province = provinceCode ? d.province.get(provinceCode) : null;
  const municipality = municipalityCode ? d.municipality.get(municipalityCode) : null;
  const barangay = barangayCode ? d.barangay.get(barangayCode) : null;
  if ((regionCode && !region) || (provinceCode && !province) || (municipalityCode && !municipality) || (barangayCode && !barangay)) {
    throw bad('That place is not in the official list. Choose it again.');
  }
  if (!region && (province || municipality || barangay)) throw bad('Choose the region first.');
  if (province && province.regionCode !== regionCode) throw bad('The province is not in the chosen region.');
  if (municipality) {
    if (!province && d.province.has(municipality.provinceCode) && d.regionOf(municipality.psgcCode) === regionCode) throw bad('Choose the province first.');
    if (municipality.area !== (province ? province.psgcCode : regionCode)) throw bad('The city or municipality is not in the chosen province.');
  }
  if (barangay && barangay.municipalCityCode !== municipalityCode) throw bad('The barangay is not in the chosen city or municipality.');

  return {
    country: 'Philippines',
    region: region ? regionLabel(region) : '', regionCode,
    province: province?.name ?? '', provinceCode,
    municipality: municipality?.name ?? '', municipalityCode,
    barangay: barangay?.name ?? '', barangayCode,
    street,
  };
}

// One line for screens and reports: "Purok 3, Nagcuartelan, Aritao, Nueva Vizcaya".
export const addressLine = (a) => [a?.street, a?.barangay, a?.municipality, a?.province].filter(Boolean).join(', ');
