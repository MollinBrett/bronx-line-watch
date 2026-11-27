/**
 * Eval set for "My stations" matching (#49): real alerts from the Nov 1, 2026 snapshot
 * (test/fixtures/mta-alerts-sample.json), each labeled by hand, from reading the alert,
 * with stations it should and should not reach.
 *
 * Unlike the rewrite eval, matching is plain code, so these run for free in `npm test`
 * (test/stations-matching.test.ts) and need no Claude call. Add a case whenever a rider
 * reports a text they shouldn't have got, or one they missed.
 */
export interface MatchingCase {
  alertId: string;
  /** What the alert says, for the person reading a failure. */
  summary: string;
  /** Stop IDs of stations whose riders should get the text. */
  reaches: string[];
  /** Stop IDs of stations whose riders should not. */
  misses: string[];
}

export const matchingCases: MatchingCase[] = [
  {
    alertId: "lmm:alert:274447:26",
    summary: "[6] delays in both directions; the feed lists no stops",
    reaches: ["608" /* Parkchester */, "615" /* E 149 St */],
    misses: ["407" /* Fordham Rd (4) */, "D05" /* Fordham Rd (B D) */],
  },
  {
    alertId: "lmm:planned_work:36103",
    summary: "Woodlawn-bound [4] skips 170 St, Mt Eden Av and 176 St",
    reaches: ["412" /* 170 St (4) */, "411" /* Mt Eden Av */],
    misses: ["401" /* Woodlawn */, "D09" /* 170 St (B D): same name, different station */],
  },
  {
    alertId: "lmm:planned_work:36012",
    summary: "In Manhattan, downtown [4][5][6] skip 86 St",
    reaches: [],
    misses: ["407" /* Fordham Rd (4) */, "608" /* Parkchester */, "213" /* E 180 St */],
  },
  {
    alertId: "lmm:planned_work:36008",
    summary: "[5] runs every 20 minutes; the feed lists no stops",
    reaches: ["505" /* Morris Park */, "213" /* E 180 St (2 5) */, "416" /* 138 St-Grand Concourse (4 5) */],
    misses: ["401" /* Woodlawn (4) */, "608" /* Parkchester (6) */],
  },
  {
    alertId: "lmm:planned_work:35952",
    summary: "No overnight [5] between Dyre Av and E 180 St",
    reaches: ["503" /* Gun Hill Rd (5) */, "213" /* E 180 St */],
    misses: ["208" /* Gun Hill Rd (2 5): same name, other branch */, "214" /* West Farms Sq */],
  },
  {
    alertId: "lmm:planned_work:35951",
    summary: "All [2] trains at E 180 St board from the downtown platform",
    reaches: ["213" /* E 180 St */],
    misses: ["214" /* West Farms Sq-E Tremont Av */, "201" /* Wakefield-241 St */],
  },
  {
    alertId: "lmm:planned_work:35787",
    summary: "Express [6X] runs local from 3 Av-138 St to Hunts Point Av",
    reaches: ["615" /* E 149 St */, "613" /* Hunts Point Av */],
    misses: ["608" /* Parkchester */, "601" /* Pelham Bay Park */],
  },
  {
    alertId: "lmm:planned_work:35758",
    summary: "[4] runs in two sections, Woodlawn to 125 St and 125 St to New Lots Av",
    // D11 is the [B][D] side of 161 St-Yankee Stadium: one station to a rider, so it counts.
    reaches: ["414" /* 161 St-Yankee Stadium */, "D11", "222" /* 149 St-Hostos, via the [4] side */],
    misses: ["D05" /* Fordham Rd (B D) */, "608" /* Parkchester */],
  },
  {
    alertId: "lmm:planned_work:35567",
    summary: "In Brooklyn, Manhattan-bound [D] runs via the [N]",
    reaches: [],
    misses: ["D05" /* Fordham Rd (B D) */, "D01" /* Norwood-205 St */],
  },
];
