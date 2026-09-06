import { Button } from "@/components/ui/button";

export function RepositoryLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="space-y-2 p-3">
      <p role="alert" className="text-xs">
        Couldn’t load repositories. Try again or reconnect GitHub in settings.
      </p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}
