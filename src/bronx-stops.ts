/**
 * GTFS parent-station IDs of every subway station in the Bronx (70 stations).
 *
 * How this list was made (2026-11-16), so anyone can rebuild or check it:
 *   1. Download the MTA "Subway Stations" dataset from data.ny.gov (dataset id 39hk-dx4f,
 *      export as CSV). It has one row per station, with a "GTFS Stop ID" and a "Borough" column.
 *   2. Keep the rows where Borough is "Bx" and take their "GTFS Stop ID".
 *   3. Cross-check: every ID is a parent station (location_type 1) in stops.txt from the
 *      MTA's GTFS static subway feed (gtfs_subway.zip on rrgtfsfeeds.s3.amazonaws.com).
 * The station name and daytime lines are in the comment after each ID, to make review easy.
 * Marble Hill-225 St is legally Manhattan, so it isn't here, matching the dataset.
 *
 * The alerts feed names parent stations ("626"). Platform IDs ("626N", "626S") are mapped
 * to their parent in src/filter.ts.
 */
export const BRONX_STOP_IDS: ReadonlySet<string> = new Set([
  "101", // Van Cortlandt Park-242 St (1)
  "103", // 238 St (1)
  "104", // 231 St (1)
  "201", // Wakefield-241 St (2)
  "204", // Nereid Av (2 5)
  "205", // 233 St (2 5)
  "206", // 225 St (2 5)
  "207", // 219 St (2 5)
  "208", // Gun Hill Rd (2 5)
  "209", // Burke Av (2 5)
  "210", // Allerton Av (2 5)
  "211", // Pelham Pkwy (2 5)
  "212", // Bronx Park East (2 5)
  "213", // E 180 St (2 5)
  "214", // West Farms Sq-E Tremont Av (2 5)
  "215", // 174 St (2 5)
  "216", // Freeman St (2 5)
  "217", // Simpson St (2 5)
  "218", // Intervale Av (2 5)
  "219", // Prospect Av (2 5)
  "220", // Jackson Av (2 5)
  "221", // 3 Av-149 St (2 5)
  "222", // 149 St-Hostos (2 5)
  "401", // Woodlawn (4)
  "402", // Mosholu Pkwy (4)
  "405", // Bedford Park Blvd-Lehman College (4)
  "406", // Kingsbridge Rd (4)
  "407", // Fordham Rd (4)
  "408", // 183 St (4)
  "409", // Burnside Av (4)
  "410", // 176 St (4)
  "411", // Mt Eden Av (4)
  "412", // 170 St (4)
  "413", // 167 St (4)
  "414", // 161 St-Yankee Stadium (4)
  "415", // 149 St-Hostos (4)
  "416", // 138 St-Grand Concourse (4 5)
  "501", // Eastchester-Dyre Av (5)
  "502", // Baychester Av (5)
  "503", // Gun Hill Rd (5)
  "504", // Pelham Pkwy (5)
  "505", // Morris Park (5)
  "601", // Pelham Bay Park (6)
  "602", // Buhre Av (6)
  "603", // Middletown Rd (6)
  "604", // Westchester Sq-E Tremont Av (6)
  "606", // Zerega Av (6)
  "607", // Castle Hill Av (6)
  "608", // Parkchester (6)
  "609", // St Lawrence Av (6)
  "610", // Morrison Av-Soundview (6)
  "611", // Elder Av (6)
  "612", // Whitlock Av (6)
  "613", // Hunts Point Av (6)
  "614", // Longwood Av (6)
  "615", // E 149 St (6)
  "616", // E 143 St-St Mary's St (6)
  "617", // Cypress Av (6)
  "618", // Brook Av (6)
  "619", // 3 Av-138 St (6)
  "D01", // Norwood-205 St (D)
  "D03", // Bedford Park Blvd (B D)
  "D04", // Kingsbridge Rd (B D)
  "D05", // Fordham Rd (B D)
  "D06", // 182-183 Sts (B D)
  "D07", // Tremont Av (B D)
  "D08", // 174-175 Sts (B D)
  "D09", // 170 St (B D)
  "D10", // 167 St (B D)
  "D11", // 161 St-Yankee Stadium (B D)
]);
