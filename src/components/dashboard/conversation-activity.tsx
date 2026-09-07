import type { WorkspaceActivity } from "../../../bridge/contracts";

export function ConversationActivity({
  activity,
  repository,
}: {
  activity?: WorkspaceActivity;
  repository: string;
}) {
  const { changes, pullRequest } = activity ?? {};
  if (!changes && !pullRequest)
    return <span className="conversation-repository">{repository}</span>;
  const state = pullRequest?.state;
  const label = state
    ? { open: "Open", draft: "Draft", merged: "Merged", closed: "Closed" }[state]
    : null;

  return (
    <span className="conversation-activity">
      {pullRequest && <span>#{pullRequest.number}</span>}
      {!pullRequest && <span className="conversation-activity-repository">{repository}</span>}
      {changes && (
        <span
          className="conversation-diff"
          title={
            changes.partial
              ? "Partial line counts; some files could not be counted"
              : "Lines added and deleted"
          }
          aria-label={`${changes.partial ? "At least " : ""}${changes.additions} lines added, ${changes.deletions} lines deleted`}
        >
          <span className="conversation-additions">
            +{changes.additions}
            {changes.partial ? "+" : ""}
          </span>
          <span className="conversation-deletions">
            −{changes.deletions}
            {changes.partial ? "+" : ""}
          </span>
        </span>
      )}
      {label && <span className={`conversation-pr-state conversation-pr-${state}`}>{label}</span>}
    </span>
  );
}
