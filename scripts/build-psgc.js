// Writes the Philippine address list (PSGC, from @aivangogh/ph-address) into
// small static files the browser loads only when needed:
//   public/psgc/regions.json            [{ code, name }]
//   public/psgc/provinces.json          { regionCode: [{ code, name }] }
//   public/psgc/municipalities.json     { provinceCode | regionCode: [{ code, name }] }
//   public/psgc/barangays/<code>.json   { municipalityCode: [{ code, name }] }
// Regions without provinces (Metro Manila) list their cities under the region code.
// Generated before `npm run dev` and `npm run build`; not committed.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { areaGroups } from '../server/lib/address.js';

const out = join(process.cwd(), 'public', 'psgc');
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'barangays'), { recursive: true });

const { regions, provincesByRegion, municipalitiesByArea, barangaysByArea } = areaGroups();
const write = (file, data) => writeFileSync(join(out, file), JSON.stringify(data));
write('regions.json', regions);
write('provinces.json', provincesByRegion);
write('municipalities.json', municipalitiesByArea);
for (const [area, byMunicipality] of Object.entries(barangaysByArea)) write(`barangays/${area}.json`, byMunicipality);

const count = Object.values(barangaysByArea).reduce((s, m) => s + Object.values(m).reduce((t, l) => t + l.length, 0), 0);
console.log(`PSGC address files: ${regions.length} regions, ${Object.keys(barangaysByArea).length} areas, ${count.toLocaleString('en-US')} barangays`);
