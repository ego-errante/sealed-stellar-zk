import { TerminalSquare } from "lucide-react";
import { REPO_URL } from "@/lib/env";

/**
 * Inline note for an action that needs the owner-local prover, shown on the hosted
 * demo where localhost:8787 isn't reachable. Explains the architecture (the prover
 * is owner-local by design) and points at the repo, rather than failing on a fetch.
 */
export function HostedNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2 rounded-md border border-alert/30 bg-alert/5 p-2 text-xs text-muted-foreground">
      <TerminalSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-alert" />
      <p>
        {children}{" "}
        <a
          href={REPO_URL}
          target="_blank"
          rel="noreferrer"
          className="text-proof underline underline-offset-2"
        >
          Run it locally
        </a>
        .
      </p>
    </div>
  );
}
