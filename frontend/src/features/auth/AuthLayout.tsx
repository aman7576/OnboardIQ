import type { ReactNode } from 'react';
import { Link } from 'react-router';

const STEPS = [
  { title: 'Upload', text: 'PDF, photo or text file' },
  { title: 'Read', text: 'OCR turns scans into text' },
  { title: 'Check', text: '17 rules run instantly' },
  { title: 'Review', text: 'A person sees doubtful cases' },
  { title: 'Decide', text: 'Maker and checker sign off' },
];

const STATS = [
  { value: '17', label: 'Compliance rules' },
  { value: '3', label: 'Role-based portals' },
  { value: '100%', label: 'Actions audited' },
];

function Logo() {
  return (
    <Link to="/login" className="inline-flex items-center gap-2.5">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-forest text-white shadow-lg shadow-forest/30">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 2 4 5.5v6c0 5 3.4 8.6 8 10.5 4.6-1.9 8-5.5 8-10.5v-6L12 2Z"
            fill="#fff"
            fillOpacity=".18"
            stroke="#fff"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path
            d="m8.5 12 2.4 2.4L15.7 9.6"
            stroke="#fff"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="fx-check"
          />
        </svg>
      </span>
      <span className="font-display text-2xl tracking-tight">OnboardIQ</span>
    </Link>
  );
}

/** A made-up application card that floats beside the timeline: purely decorative, marked as a sample. */
function SampleCard() {
  return (
    <div
      className="fx-float relative hidden w-60 shrink-0 rounded-2xl border border-line bg-white p-4 shadow-xl md:block"
      aria-hidden="true"
    >
      <div className="flex items-center justify-between">
        <span className="text-[0.65rem] font-semibold tracking-widest text-ink-soft uppercase">
          Sample
        </span>
        <span className="relative grid h-5 w-5 place-items-center">
          <span className="fx-ring absolute inset-0 rounded-full bg-forest/40" />
          <span className="relative h-2.5 w-2.5 rounded-full bg-forest" />
        </span>
      </div>
      <p className="mt-2 font-display text-lg">Application</p>
      <div className="mt-3 grid gap-2">
        <div className="fx-skeleton h-2.5 w-4/5 rounded" />
        <div className="fx-skeleton h-2.5 w-3/5 rounded" />
        <div className="fx-skeleton h-2.5 w-2/3 rounded" />
      </div>
      <div className="mt-4 flex gap-1.5">
        {['PAN', 'Aadhaar', 'Address'].map((d) => (
          <span
            key={d}
            className="rounded-full bg-forest-soft px-2 py-0.5 text-[0.65rem] font-medium text-forest"
          >
            {d} ✓
          </span>
        ))}
      </div>
      <div className="mt-4 rounded-lg bg-forest px-3 py-2 text-center text-xs font-medium text-white">
        Checks passed
      </div>
    </div>
  );
}

/** Split screen for customer sign-in and registration: animated story on the left, glass form card on the right. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative isolate grid min-h-screen overflow-hidden bg-ivory lg:grid-cols-[1.25fr_1fr]">
      <div className="fx-aurora" aria-hidden="true" />
      <div className="fx-grid absolute inset-0 -z-10" aria-hidden="true" />

      <section className="fx-stagger flex flex-col justify-center px-6 py-10 sm:px-12 lg:px-16">
        <Logo />
        <p className="mt-10 inline-flex w-fit items-center gap-2 rounded-full border border-forest/20 bg-white/70 px-3 py-1 text-xs font-medium text-forest backdrop-blur">
          <span className="relative grid h-2 w-2 place-items-center">
            <span className="fx-ring absolute inset-0 rounded-full bg-forest" />
            <span className="h-2 w-2 rounded-full bg-forest" />
          </span>
          Savings account onboarding
        </p>
        <h1 className="mt-4 max-w-2xl font-display text-4xl leading-[1.1] tracking-tight sm:text-5xl lg:text-6xl">
          Clean applications in <span className="fx-shimmer-text">minutes</span>, doubtful ones to a
          person.
        </h1>
        <p className="mt-4 max-w-xl text-lg text-ink-soft">
          AI proposes, rules decide, humans approve. Every decision and document view is audited.
        </p>

        <div className="mt-10 flex items-start gap-10">
          <ol className="grid max-w-sm flex-1 gap-0" aria-label="How an application moves">
            {STEPS.map((s, i) => (
              <li
                key={s.title}
                className="relative flex gap-4 pb-5 last:pb-0"
                style={{ ['--i' as string]: i }}
              >
                {i < STEPS.length - 1 && (
                  <>
                    <span className="absolute top-9 bottom-0 left-[1.05rem] w-0.5 bg-line" />
                    <span className="fx-line absolute top-9 bottom-0 left-[1.05rem] w-0.5 bg-forest" />
                  </>
                )}
                <span className="fx-step relative z-10 grid h-9 w-9 shrink-0 place-items-center rounded-full border-2 text-sm font-semibold">
                  {i + 1}
                </span>
                <span className="leading-tight">
                  <span className="block font-medium">{s.title}</span>
                  <span className="block text-sm text-ink-soft">{s.text}</span>
                </span>
              </li>
            ))}
          </ol>
          <SampleCard />
        </div>

        <dl className="mt-10 flex flex-wrap gap-x-10 gap-y-4 border-t border-line/70 pt-6">
          {STATS.map((s) => (
            <div key={s.label}>
              <dt className="sr-only">{s.label}</dt>
              <dd className="font-display text-3xl text-forest">{s.value}</dd>
              <dd className="text-xs tracking-wide text-ink-soft uppercase">{s.label}</dd>
            </div>
          ))}
        </dl>
      </section>

      <main className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="fx-up w-full max-w-md [animation-delay:0.15s]">{children}</div>
      </main>
    </div>
  );
}
