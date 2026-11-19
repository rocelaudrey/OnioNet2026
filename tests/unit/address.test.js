import { describe, it, expect } from 'vitest';
import { addressLine, areaGroups, resolveAddress } from '../../server/lib/address.js';

// Official PSGC codes.
const NV = { regionCode: '0200000000', provinceCode: '0205000000', municipalityCode: '0205002000', barangayCode: '0205002010' };

describe('resolveAddress', () => {
  it('fills in the official names from the codes', () => {
    expect(resolveAddress({ ...NV, street: ' Purok 3 ' })).toEqual({
      country: 'Philippines',
      region: 'Region II (Cagayan Valley)', regionCode: '0200000000',
      province: 'Nueva Vizcaya', provinceCode: '0205000000',
      municipality: 'Aritao', municipalityCode: '0205002000',
      barangay: 'Nagcuartelan', barangayCode: '0205002010',
      street: 'Purok 3',
    });
  });

  it('ignores names sent by the browser', () => {
    expect(resolveAddress({ ...NV, barangay: 'Fake', municipality: 'Fake' })).toMatchObject({ barangay: 'Nagcuartelan', municipality: 'Aritao' });
  });

  it('allows stopping at any level, including no address at all', () => {
    expect(resolveAddress({ regionCode: NV.regionCode, provinceCode: NV.provinceCode })).toMatchObject({ province: 'Nueva Vizcaya', municipality: '', barangay: '' });
    expect(resolveAddress({})).toMatchObject({ country: 'Philippines', region: '', barangay: '' });
  });

  it('handles Metro Manila, which has no provinces', () => {
    expect(resolveAddress({ regionCode: '1300000000', municipalityCode: '1380300000', barangayCode: '1380300001' }))
      .toMatchObject({ region: 'National Capital Region (NCR)', province: '', municipality: 'Makati City', barangay: 'Bangkal' });
    expect(() => resolveAddress({ regionCode: '1300000000', provinceCode: NV.provinceCode })).toThrow(/not in the chosen region/);
  });

  it('handles towns that belong to a region but no province', () => {
    expect(resolveAddress({ regionCode: '0900000000', municipalityCode: '0990101000', barangayCode: '0990101002' }))
      .toMatchObject({ province: '', municipality: 'Isabela City', barangay: 'Aguada' });
  });

  it('rejects places that do not fit together, or are not in the list', () => {
    expect(() => resolveAddress({ ...NV, barangayCode: '1380300001' })).toThrow(/barangay is not in/);
    expect(() => resolveAddress({ ...NV, municipalityCode: '1380300000', barangayCode: '' })).toThrow(/not in the chosen province/);
    expect(() => resolveAddress({ ...NV, regionCode: '0100000000' })).toThrow(/not in the chosen region/);
    expect(() => resolveAddress({ regionCode: NV.regionCode, municipalityCode: NV.municipalityCode })).toThrow(/province first/);
    expect(() => resolveAddress({ provinceCode: NV.provinceCode })).toThrow(/region first/);
    expect(() => resolveAddress({ ...NV, barangayCode: '0205002999' })).toThrow(/not in the official list/);
    expect(() => resolveAddress({ ...NV, barangayCode: 'Nagcuartelan' })).toThrow(/from the lists/);
  });
});

describe('address data', () => {
  it('covers every region and puts every barangay under exactly one area', () => {
    const g = areaGroups();
    expect(g.regions).toHaveLength(18);
    const barangays = Object.values(g.barangaysByArea).flatMap((m) => Object.values(m)).flat();
    expect(barangays.length).toBeGreaterThan(42000);
    expect(new Set(barangays.map((b) => b.code)).size).toBe(barangays.length);
    expect(g.municipalitiesByArea['0205000000'].map((m) => m.name)).toContain('Aritao');
  });

  it('writes one line for screens and reports', () => {
    expect(addressLine(resolveAddress({ ...NV, street: 'Purok 3' }))).toBe('Purok 3, Nagcuartelan, Aritao, Nueva Vizcaya');
    expect(addressLine({ barangay: 'Old free text', municipality: 'Aritao' })).toBe('Old free text, Aritao');
    expect(addressLine(undefined)).toBe('');
  });
});
