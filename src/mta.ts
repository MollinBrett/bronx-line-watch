import { z } from "zod";

/** MTA's public GTFS-realtime subway alerts feed, JSON flavor. No API key needed. */
export const MTA_ALERTS_URL =
  "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fsubway-alerts.json";

/** A subway alert, flattened from the MTA's nested GTFS-realtime shape. */
export interface Alert {
  id: string;
  routes: string[];
  /** MTA's own category, e.g. "Delays", "Planned - Stops Skipped". */
  type: string;
  header: string;
  description: string;
  activePeriods: { start: number; end?: number }[];
  /** Unix seconds. */
  updatedAt: number;
}

const Translations = z
  .object({ translation: z.array(z.object({ text: z.string(), language: z.string() })) })
  .optional();

// Only the fields we use are validated; the MTA adds extra fields freely.
const FeedSchema = z.object({
  entity: z.array(
    z.object({
      id: z.string(),
      alert: z.object({
        active_period: z.array(z.object({ start: z.number(), end: z.number().optional() })).optional(),
        informed_entity: z.array(z.object({ route_id: z.string().optional() })).optional(),
        header_text: Translations,
        description_text: Translations,
        "transit_realtime.mercury_alert": z
          .object({ alert_type: z.string().optional(), updated_at: z.number().optional() })
          .optional(),
      }),
    }),
  ),
});

function plainText(t: z.infer<typeof Translations>): string {
  return t?.translation.find((x) => x.language === "en")?.text.trim() ?? "";
}

/** Parse a raw feed body into Alerts. Throws if the MTA changes the shape we depend on. */
export function parseFeed(raw: unknown): Alert[] {
  const feed = FeedSchema.parse(raw);
  return feed.entity.map(({ id, alert }) => {
    const meta = alert["transit_realtime.mercury_alert"];
    const routes = [
      ...new Set((alert.informed_entity ?? []).flatMap((e) => (e.route_id ? [e.route_id] : []))),
    ];
    return {
      id,
      routes,
      type: meta?.alert_type ?? "Unknown",
      header: plainText(alert.header_text),
      description: plainText(alert.description_text),
      activePeriods: alert.active_period ?? [],
      updatedAt: meta?.updated_at ?? 0,
    };
  });
}

export async function fetchAlerts(url = MTA_ALERTS_URL): Promise<Alert[]> {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`MTA feed returned HTTP ${res.status}`);
  return parseFeed(await res.json());
}
