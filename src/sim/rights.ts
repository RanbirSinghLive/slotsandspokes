import airportCountriesData from '../../data/airport-countries.json';
import airRightsData from '../../data/air-rights.json';
import type { SimState } from './state';

/**
 * Air rights: which routes and connections an airline of one country may
 * fly and sell in another (HOW-IT-WORKS.md, "Air rights"; the plan is
 * roadmap/air-rights-spec.md).
 *
 * An airline's home country is the country of its home airport. A leg is
 * *domestic* when both ends are in that country, *cabotage* when both ends
 * are in some other country (barred, unless a bloc grants it), and
 * *international* otherwise. A connection A-hub-B between two airports in
 * one foreign country is cabotage by another route and is barred too.
 *
 * Pure reads of `data/`: nothing here is saved, so no save format change.
 * An airport with no known country is treated as allowed, so a missing row
 * can never stop a route.
 */

type AirRights = {
  sovereignty: Record<string, string>;
  blocs: { id: string; name: string; cabotage: boolean; countries: string[] }[];
  closed: [string, string][];
};
const rights = airRightsData as AirRights;
const countries = airportCountriesData as Record<string, string>;

const closedPairs = new Set(rights.closed.map(([a, b]) => [a, b].sort().join('-')));
const cabotageBlocs = rights.blocs.filter((bloc) => bloc.cabotage).map((bloc) => new Set(bloc.countries));

export type Rights = { ok: true } | { ok: false; reason: string };
const ALLOWED: Rights = { ok: true };

/** The country an airport's rights follow: its own, or the one that governs it (Puerto Rico follows the US). */
export function countryOf(iata: string): string | undefined {
  const country = countries[iata];
  return country === undefined ? undefined : (rights.sovereignty[country] ?? country);
}

/** The airline's home country: where its home airport is. */
export function homeCountry(state: Pick<SimState, 'homeAirport'>): string | undefined {
  return countryOf(state.homeAirport);
}

/** True when airlines of `home` may carry domestic traffic inside `country`: it is theirs, or a bloc they share with it grants cabotage. */
function mayFlyInside(home: string, country: string): boolean {
  return home === country || cabotageBlocs.some((bloc) => bloc.has(home) && bloc.has(country));
}

/** May an airline of `home` fly a leg between `a` and `b`? */
export function legRights(home: string | undefined, a: string, b: string): Rights {
  const countryA = countryOf(a);
  const countryB = countryOf(b);
  if (!home || !countryA || !countryB) return ALLOWED;
  if (countryA === countryB) {
    return mayFlyInside(home, countryA) ? ALLOWED : { ok: false, reason: `${a} → ${b} · cabotage barred for ${home} carriers` };
  }
  if (closedPairs.has([countryA, countryB].sort().join('-'))) {
    return { ok: false, reason: `${a} → ${b} · no air services between ${countryA} and ${countryB}` };
  }
  return ALLOWED;
}

/** May an airline of `home` sell a connection from `a` to `b` through `hub`? Both legs must be flyable, and two airports in one foreign country can't be joined through anywhere. */
export function flowRights(home: string | undefined, a: string, hub: string, b: string): Rights {
  const countryA = countryOf(a);
  const countryB = countryOf(b);
  if (home && countryA && countryA === countryB && !mayFlyInside(home, countryA)) {
    return { ok: false, reason: `${a}–${b} via ${hub} · cabotage barred for ${home} carriers` };
  }
  const first = legRights(home, a, hub);
  return first.ok ? legRights(home, hub, b) : first;
}
