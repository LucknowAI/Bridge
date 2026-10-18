import { isInProgress, type QueueState } from "@/src/domain/matching/match-status";
import { ActionForm, type FormAction } from "../ui/form";
import AutoRefresh from "./AutoRefresh";

const EMPTY: Record<QueueState, { title: string; body: string; button?: string }> = {
  none: { title: "Your matches have not been computed yet.", body: "Start matching to rank attendees for your profile.", button: "Find my matches" },
  queued: { title: "Your matches are queued.", body: "Attendees are ranked in the background. This page updates on its own." },
  running: { title: "Ranking attendees for you…", body: "This usually takes under a minute. This page updates on its own." },
  stuck: { title: "Matching is taking longer than expected.", body: "Something may have interrupted it.", button: "Try again" },
  failed: { title: "We could not compute your matches.", body: "Matching failed after several attempts. Try again, or tell the organizer if it keeps failing.", button: "Try again" },
  done: { title: "No matches yet.", body: "Nobody compatible has completed a profile yet. Check back as more attendees join.", button: "Check again" },
};

/**
 * What the matches page says about background matching. With no matches it
 * explains the state; with matches it only flags an update in progress or a
 * failed one. `refresh` is omitted when the event no longer allows refreshing.
 */
export default function MatchStatus({ state, hasMatches, refresh }: { state: QueueState; hasMatches: boolean; refresh?: FormAction }) {
  const working = isInProgress(state) && <AutoRefresh />;
  const retry = (label: string) => refresh && <ActionForm action={refresh} label={label} pendingLabel="Queuing…" />;

  if (hasMatches) {
    if (isInProgress(state)) return <p role="status" className="notice">Updating your matches…{working}</p>;
    if (state === "stuck" || state === "failed") {
      return <div role="status" className="form-alert">
        <p style={{ marginTop: 0 }}>The last update did not finish. These are your previous matches.</p>
        {retry("Try again")}
      </div>;
    }
    return null;
  }

  if (!refresh && !isInProgress(state)) {
    return <section className="empty-state"><h2>No matches were saved for you.</h2><p>This event has closed.</p></section>;
  }
  const copy = EMPTY[state];
  return <section className="empty-state" role="status">
    <h2>{copy.title}</h2>
    <p>{copy.body}</p>
    {working}
    {copy.button && retry(copy.button)}
  </section>;
}
