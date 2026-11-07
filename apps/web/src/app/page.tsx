import Link from "next/link";
import { ArrowRight, Bot, CircleDollarSign, LockKeyhole, Waypoints } from "lucide-react";
import { Rule } from "@/components/bits";

const JOURNEY = [
  { n: "01", title: "Agree", body: "Acceptance criteria are written, hashed and accepted by both parties before any money moves." },
  { n: "02", title: "Fund", body: "The client funds the milestone in USDC through the Arc escrow contract." },
  { n: "03", title: "Work", body: "The deliverable is submitted and its hash is anchored on-chain, so it cannot be swapped later." },
  { n: "04", title: "Evaluate", body: "0G's Private Computer scores the work against each locked criterion. Advisory only." },
  { n: "05", title: "Verify", body: "Agent payments settle on Hedera and are confirmed against the public Mirror Node." },
  { n: "06", title: "Release", body: "The client's own wallet releases the funds. Nothing else can." },
];

const TRACKS = [
  { icon: CircleDollarSign, name: "ARC", title: "Milestone escrow", body: "USDC funding and client-authorised release on Arc Testnet, chain 5042002." },
  { icon: Bot, name: "0G", title: "Private evaluation", body: "Criteria-based deliverable review on glm-5.3. Advisory, provider-reported, never a payment authority." },
  { icon: Waypoints, name: "HEDERA", title: "Agent settlement", body: "HTTP 402 exact payments between agents, bounded by policy and verified on the Mirror Node." },
];

/** Three ecosystems converging on one evidence trail. Drawn, not decorative. */
function EcosystemDiagram() {
  const cols = [
    { x: 86, label: "ARC", sub: "escrow" },
    { x: 260, label: "0G", sub: "evaluation" },
    { x: 434, label: "HEDERA", sub: "settlement" },
  ];
  return (
    <svg viewBox="0 0 520 300" className="h-auto w-full" role="img" aria-label="Arc escrow, 0G evaluation and Hedera settlement converge into a single ProofTrack evidence trail.">
      <defs>
        <pattern id="grid" width="26" height="26" patternUnits="userSpaceOnUse">
          <path d="M26 0H0v26" fill="none" stroke="#17243a" strokeOpacity="0.05" strokeWidth="1" />
        </pattern>
      </defs>
      <rect x="0" y="0" width="520" height="300" fill="url(#grid)" />
      {cols.map((c) => (
        <g key={c.label}>
          <rect x={c.x - 58} y="30" width="116" height="58" rx="10" fill="#ffffff" stroke="#e2e3dd" />
          <text x={c.x} y="55" textAnchor="middle" className="mono" fontSize="11" fill="#4969d6" letterSpacing="1.4">{c.label}</text>
          <text x={c.x} y="73" textAnchor="middle" fontSize="11" fill="#78818c">{c.sub}</text>
          <path d={`M${c.x} 88 V150 Q${c.x} 168 ${c.x < 260 ? c.x + 18 : c.x > 260 ? c.x - 18 : c.x} 168 H260`} fill="none" stroke="#a8b9aa" strokeWidth="1.5" />
          <circle cx={c.x} cy="88" r="2.5" fill="#a8b9aa" />
        </g>
      ))}
      <line x1="260" y1="168" x2="260" y2="196" stroke="#a8b9aa" strokeWidth="1.5" />
      <rect x="146" y="196" width="228" height="62" rx="12" fill="#17243a" />
      <text x="260" y="220" textAnchor="middle" className="mono" fontSize="11" fill="#a8b9aa" letterSpacing="1.4">PROOFTRACK</text>
      <text x="260" y="240" textAnchor="middle" fontSize="11.5" fill="#f5f5f0">One public, verifiable trail</text>
      <text x="260" y="282" textAnchor="middle" fontSize="10.5" fill="#78818c">Verified on-chain · advisory marked as advisory</text>
    </svg>
  );
}

export default function Landing() {
  return (
    <div className="space-y-24 sm:space-y-32">
      {/* ---------------------------------------------------------------- hero */}
      <section className="anim-rise grid gap-12 pt-6 lg:grid-cols-12 lg:items-end lg:gap-10">
        <div className="lg:col-span-8">
          <p className="eyebrow mb-5">Programmable trust infrastructure</p>
          <h1 className="display display-xl text-ink">
            Trust, made
            <br />
            programmable.
          </h1>
          <p className="lede mt-7 max-w-prose">
            Milestone escrow in real USDC, AI evaluation that knows its own limits, and autonomous
            agent payments — each one leaving evidence a stranger can verify without trusting us.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link
              href="/projects/new"
              className="inline-flex items-center gap-2 rounded-sm bg-ink px-5 py-3 text-sm font-medium text-ink-inverse shadow-soft transition-all duration-150 hover:bg-[#0f1829] active:translate-y-px"
            >
              Start a contract <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 rounded-sm border border-rule-strong bg-surface px-5 py-3 text-sm font-medium text-ink transition-colors duration-150 hover:border-ink-3 active:translate-y-px"
            >
              Open dashboard
            </Link>
          </div>
        </div>

        {/* Floating glass status rail: the one place glass earns its keep on this page. */}
        <aside className="glass glass-sheen rounded-md p-5 lg:col-span-4">
          <p className="eyebrow">Live integrations</p>
          <dl className="mt-4 space-y-3.5">
            {[
              ["Arc Testnet", "chain 5042002"],
              ["0G Private Computer", "glm-5.3 · private"],
              ["Hedera x402", "testnet · supervised"],
            ].map(([name, meta]) => (
              <div key={name} className="flex items-baseline justify-between gap-3">
                <dt className="text-sm font-medium text-ink">{name}</dt>
                <dd className="mono text-[0.6875rem] text-ink-3">{meta}</dd>
              </div>
            ))}
          </dl>
          <div className="rule-t mt-4 pt-3.5">
            <p className="flex items-center gap-2 text-xs text-ink-2">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ok" />
              Escrow deployed and verified
            </p>
          </div>
        </aside>
      </section>

      {/* ------------------------------------------------------------- journey */}
      <section>
        <div className="grid gap-10 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <p className="eyebrow mb-4">The journey</p>
            <h2 className="display display-lg text-ink">
              Every milestone.
              <br />
              Accounted for.
            </h2>
            <p className="mt-5 max-w-sm leading-7 text-ink-2">
              Six steps, each leaving a record. The decision to pay never leaves the client's wallet.
            </p>
          </div>
          <ol className="lg:col-span-7">
            {JOURNEY.map((s, i) => (
              <li key={s.n} className={`grid grid-cols-[3.25rem_1fr] gap-5 py-6 ${i === 0 ? "" : "rule-t"}`}>
                <span className="mono pt-1 text-sm text-royal">{s.n}</span>
                <div>
                  <h3 className="display text-lg font-semibold tracking-[-0.02em] text-ink">{s.title}</h3>
                  <p className="mt-1.5 max-w-prose text-sm leading-6 text-ink-2">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ------------------------------------------------------------ diagram */}
      <section className="grid gap-12 lg:grid-cols-12 lg:items-center">
        <div className="lg:col-span-5">
          <p className="eyebrow mb-4">Three chains, one record</p>
          <h2 className="display display-lg text-ink">Proof beyond promises.</h2>
          <p className="mt-5 max-w-sm leading-7 text-ink-2">
            Arc holds the money, 0G reviews the work, Hedera pays the machines. ProofTrack folds all
            three into a single trail and is careful to label what is actually verified.
          </p>
        </div>
        <div className="surface rounded-md p-5 sm:p-7 lg:col-span-7">
          <EcosystemDiagram />
        </div>
      </section>

      {/* ------------------------------------------------------------- tracks */}
      <section>
        <Rule label="Technology tracks" className="mb-9" />
        <div className="grid gap-px overflow-hidden rounded-md border border-rule bg-rule sm:grid-cols-3">
          {TRACKS.map((t) => (
            <article key={t.name} className="bg-surface p-6 sm:p-7">
              <t.icon className="h-5 w-5 text-royal" />
              <p className="mono mt-5 text-[0.6875rem] tracking-[0.14em] text-royal">{t.name}</p>
              <h3 className="display mt-1.5 text-lg font-semibold tracking-[-0.02em] text-ink">{t.title}</h3>
              <p className="mt-2.5 text-sm leading-6 text-ink-2">{t.body}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ----------------------------------------------------------- guardrail */}
      <section className="overflow-hidden rounded-lg bg-ink px-6 py-12 sm:px-12 sm:py-16">
        <div className="grid gap-10 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-8">
            <LockKeyhole className="h-6 w-6 text-sage" />
            <h2 className="display display-lg mt-6 text-ink-inverse">
              AI can advise.
              <br />
              It can never pay.
            </h2>
            <p className="mt-5 max-w-prose leading-7 text-[#b9c0cb]">
              Only the client's wallet can release a milestone. That is not a policy we promise — it
              is a contract test that runs on every commit.
            </p>
          </div>
          <div className="lg:col-span-4">
            <div className="rounded-md border border-white/10 bg-white/[0.04] p-4">
              <p className="mono text-[0.6875rem] leading-relaxed text-sage">
                ✔ CRITICAL: AI or unauthorized
                <br />
                &nbsp;&nbsp;agent CANNOT release escrow
                <br />
                &nbsp;&nbsp;funds
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------------- close */}
      <section className="rule-t flex flex-wrap items-baseline justify-between gap-5 pt-8">
        <p className="display text-xl font-semibold tracking-[-0.025em] text-ink">
          Evidence you can verify.
        </p>
        <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm font-medium text-royal transition-colors hover:text-royal-deep">
          Open the dashboard <ArrowRight className="h-4 w-4" />
        </Link>
      </section>
    </div>
  );
}
