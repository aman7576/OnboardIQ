import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router';

// Illustration only: made-up case rows that show what the review queue looks like. No real data.
const QUEUE = [
  { id: 'Case 01', risk: 'High', tone: 'bg-red-400/90', width: 0.92, note: 'Address mismatch' },
  {
    id: 'Case 02',
    risk: 'Medium',
    tone: 'bg-amber-300/90',
    width: 0.64,
    note: 'Low OCR confidence',
  },
  { id: 'Case 03', risk: 'Medium', tone: 'bg-amber-300/90', width: 0.48, note: 'Name differs' },
  {
    id: 'Case 04',
    risk: 'Low',
    tone: 'bg-emerald-300/90',
    width: 0.22,
    note: 'Ready for sign-off',
  },
];

const FEATURES = [
  {
    title: 'Risk-ranked queue',
    text: 'The riskiest case that has waited longest is always on top.',
    icon: 'M3 6h18M6 12h12M10 18h4',
  },
  {
    title: 'Maker-checker control',
    text: 'The officer who recommends can never approve the same case.',
    icon: 'M9 12l2 2 4-4M12 3l8 3v6c0 4.5-3.2 7.7-8 9-4.8-1.3-8-4.5-8-9V6l8-3Z',
  },
  {
    title: 'Complete audit trail',
    text: 'Every view, correction and decision is written to the log.',
    icon: 'M7 3h8l4 4v14H7V3Zm8 0v4h4M10 12h6M10 16h6',
  },
];

function Icon({ d }: { d: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

function Shield() {
  return (
    <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/15 ring-1 ring-white/25 backdrop-blur">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M12 2 4 5.5v6c0 5 3.4 8.6 8 10.5 4.6-1.9 8-5.5 8-10.5v-6L12 2Z"
          stroke="#fff"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
        <path
          d="m8.5 12 2.4 2.4L15.7 9.6"
          stroke="#9fe3c0"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="fx-check"
        />
      </svg>
    </span>
  );
}

/** Decorative queue: rows highlight one after another while a scan line sweeps down the list. */
function LiveQueue() {
  return (
    <div
      className="fx-up relative overflow-hidden rounded-2xl border border-white/15 bg-white/[0.07] p-4 backdrop-blur-md [animation-delay:0.35s]"
      aria-hidden="true"
    >
      <div className="mb-3 flex items-center justify-between text-xs text-forest-soft">
        <span className="font-semibold tracking-widest uppercase">Review queue</span>
        <span className="flex items-center gap-1.5">
          <span className="relative grid h-2 w-2 place-items-center">
            <span className="fx-ring absolute inset-0 rounded-full bg-emerald-300" />
            <span className="h-2 w-2 rounded-full bg-emerald-300" />
          </span>
          Live · illustration
        </span>
      </div>
      <div className="relative grid gap-2">
        <span className="fx-scan" />
        {QUEUE.map((c, i) => (
          <div
            key={c.id}
            className="fx-row rounded-xl px-3 py-2.5"
            style={{ '--i': i } as CSSProperties}
          >
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="font-medium">{c.id}</span>
              <span className="text-xs text-forest-soft">{c.note}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[0.65rem] font-semibold text-ink ${c.tone}`}
              >
                {c.risk}
              </span>
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
              <div
                className={`fx-bar h-full w-full rounded-full ${c.tone}`}
                style={{ '--i': i, '--w': c.width } as CSSProperties}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Maker → checker: a dot travels from one node to the other, the way a recommendation moves. */
function FourEyes() {
  return (
    <div
      className="fx-up flex items-center gap-3 rounded-2xl border border-white/15 bg-white/[0.07] px-4 py-3 backdrop-blur-md [animation-delay:0.5s]"
      aria-hidden="true"
    >
      <div className="fx-node grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/15 text-[0.65rem] font-semibold">
        Maker
      </div>
      <div className="relative h-0.5 flex-1 rounded bg-white/20">
        <span className="fx-travel" />
      </div>
      <div className="fx-node grid h-11 w-11 shrink-0 place-items-center rounded-full bg-emerald-300 text-[0.65rem] font-semibold text-ink [animation-delay:1.4s]">
        Checker
      </div>
    </div>
  );
}

/** Split-screen frame shared by officer sign-in and registration. */
export function OfficerLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen bg-ivory lg:grid-cols-[1.15fr_1fr]">
      <aside className="relative isolate flex flex-col overflow-hidden bg-forest-deep px-6 py-10 text-white sm:px-12 lg:py-12">
        <div className="fx-aurora fx-aurora-dark" aria-hidden="true" />
        <div className="fx-stagger relative flex flex-1 flex-col">
          <div className="flex items-center gap-3">
            <Shield />
            <span className="font-display text-2xl tracking-tight">
              OnboardIQ
              <span className="ml-1 align-super font-sans text-[0.6rem] font-semibold tracking-widest text-forest-soft">
                OFFICER
              </span>
            </span>
          </div>

          <h1 className="mt-10 max-w-lg font-display text-4xl leading-[1.1] sm:text-5xl">
            Decisions that hold up to an <span className="text-emerald-300">audit</span>.
          </h1>
          <p className="mt-4 max-w-md text-forest-soft">
            Officer portal for KYC and Compliance teams of Deccan Digital Bank.
          </p>

          <div className="mt-8 hidden gap-4 lg:grid">
            <LiveQueue />
            <FourEyes />
          </div>

          <ul className="mt-8 grid gap-4 sm:grid-cols-3 lg:mt-auto lg:pt-8">
            {FEATURES.map((f, i) => (
              <li key={f.title} className="fx-count text-sm" style={{ '--i': i } as CSSProperties}>
                <span className="mb-2 grid h-9 w-9 place-items-center rounded-lg bg-white/10 text-emerald-300">
                  <Icon d={f.icon} />
                </span>
                <span className="block font-medium">{f.title}</span>
                <span className="mt-0.5 block text-xs leading-snug text-forest-soft">{f.text}</span>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <main className="relative isolate flex items-center justify-center overflow-hidden px-4 py-10 sm:px-8">
        <div className="fx-aurora" aria-hidden="true" />
        <div className="fx-grid absolute inset-0 -z-10" aria-hidden="true" />
        <div className="fx-up w-full max-w-md [animation-delay:0.2s]">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-forest/20 bg-white/70 px-3 py-1 text-xs font-medium text-forest backdrop-blur">
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="4" y="11" width="16" height="10" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
            Authorised bank staff only
          </p>
          {children}
          <p className="mt-6 text-center text-sm text-ink-soft">
            Applying for an account?{' '}
            <Link to="/login" className="font-medium text-forest underline">
              Customer sign in
            </Link>
          </p>
          <p className="mt-2 text-center text-xs text-ink-soft/80">
            Every sign-in and action is recorded.
          </p>
        </div>
      </main>
    </div>
  );
}
