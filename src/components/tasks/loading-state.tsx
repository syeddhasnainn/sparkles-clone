import { useEffect, useState } from "react";

const chevron = Array.from({ length: 9 }, (_, index) => {
  const row = Math.floor(index / 3);
  const column = index % 3;
  return (column + Math.abs(row - 1)) * 90;
});

export function LoadingState({ label = "Churning" }: { label?: string }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const started = performance.now();
    const timer = setInterval(() => setElapsed((performance.now() - started) / 1000), 100);
    return () => clearInterval(timer);
  }, []);

  const time =
    elapsed < 60
      ? `${elapsed.toFixed(1)}s`
      : `${Math.floor(elapsed / 60)}m ${(elapsed % 60).toFixed(1)}s`;

  return (
    <div className="task-loading" role="status">
      <span className="task-loading-grid" aria-hidden="true">
        {chevron.map((delay, index) => (
          <span
            key={index}
            className="task-loading-pixel"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </span>
      <span className="task-loading-label">{label}</span>
      <span className="task-loading-elapsed" aria-hidden="true">
        {time}
      </span>
    </div>
  );
}
