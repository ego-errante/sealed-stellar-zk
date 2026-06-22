import { ShieldCheck } from "lucide-react";
import { WalletButton } from "@/components/WalletButton";
import { Overview } from "@/components/Overview";
import { MastheadStats } from "@/components/MastheadStats";

export default function Home() {
  return (
    <main className="min-h-screen">
      {/* Masthead — the thesis, not a generic hero */}
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="h-5 w-5 text-proof" />
            <span className="font-display text-lg font-bold tracking-tight">
              Sealed
            </span>
            <span className="ml-2 hidden text-sm text-muted-foreground sm:inline">
              Prove answers. Reveal nothing.
            </span>
          </div>
          <WalletButton />
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-6 pb-12 pt-14">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-proof">
          Private data marketplace · Stellar · zero-knowledge
        </p>
        <h1 className="mt-4 max-w-3xl text-4xl font-bold leading-tight sm:text-5xl">
          A dataset’s rows stay{" "}
          <span className="redaction px-2 py-0.5 align-middle">████████</span>.
          <br />
          Only the proven aggregate is revealed.
        </h1>
        <p className="mt-6 max-w-2xl text-muted-foreground">
          An owner commits a dataset on Stellar. A buyer asks for an aggregate —
          COUNT, SUM, AVG — over a filter. The owner proves the answer with a
          RISC&nbsp;Zero proof; a Soroban contract verifies it and binds the
          result. The buyer trusts the math, not the owner.
        </p>

        <MastheadStats />
      </section>

      <Overview />
    </main>
  );
}
