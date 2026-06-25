import { Radio } from "lucide-react";
import { REPO_URL } from "@/lib/env";

/**
 * Masthead strip shown only on the hosted demo (NEXT_PUBLIC_HOSTED=1). Sets honest
 * expectations: what a visitor can do here vs. what the owner-local prover does.
 */
export function HostedBanner() {
  return (
    <div className="border-b border-border bg-card/40">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 px-6 py-2 text-xs">
        <span className="flex items-center gap-1.5 whitespace-nowrap font-mono uppercase tracking-wider text-proof">
          <Radio className="h-3.5 w-3.5" /> Live demo · Stellar testnet
        </span>
        <span className="text-muted-foreground">
          Browse sealed datasets, read each query in plain English, and inspect
          proofs verified on-chain. Registering and live proving run the prover on
          the owner’s own machine by design.
        </span>
        <a
          href={REPO_URL}
          target="_blank"
          rel="noreferrer"
          className="whitespace-nowrap text-proof underline underline-offset-2"
        >
          Source &amp; local setup →
        </a>
      </div>
    </div>
  );
}
