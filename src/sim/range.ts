import aircraftTypesData from '../../data/aircraft-types.json';
import type { SimState } from './state';

/** Ultra-long-range kit (sim/innovations.ts): extra range for the widebody, in nautical miles. */
export const ULTRA_LONG_RANGE_BONUS_NM = 3000;

const rangeByType = new Map((aircraftTypesData as { code: string; rangeNm: number }[]).map((type) => [type.code, type.rangeNm]));

/** The range a type of plane has in this airline's hands: its listed range, plus the widebody's ultra-long-range kit once researched. */
export function rangeNmFor(state: SimState, typeCode: string): number {
  const listed = rangeByType.get(typeCode) ?? 0;
  return typeCode === 'WIDEBODY' && state.adoptedInnovations?.includes('ultra-long-range') ? listed + ULTRA_LONG_RANGE_BONUS_NM : listed;
}
