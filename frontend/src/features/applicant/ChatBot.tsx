import { useEffect, useRef, useState, type FormEvent } from 'react';
import { askAssistant, type ChatMessage } from '@/api/chat';
import { ApiError } from '@/api/http';
import { cn } from '@/lib/utils';

const SUGGESTIONS = [
  'Which documents do I need?',
  'What is my application status?',
  'How do I upload a photo or scan?',
  'How long does the review take?',
];

const GREETING: ChatMessage = {
  role: 'assistant',
  content:
    'Hello! I am IQ, your OnboardIQ assistant. Ask me anything about documents, uploads or your application status. (Please do not type your Aadhaar/PAN number or OTP here.)',
};

/** The IQ robot: a small friendly face with a blinking eye and a glowing antenna. */
function Robot({ size = 40, talking = false }: { size?: number; talking?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      className={cn('shrink-0', talking && 'iq-talk')}
    >
      <line x1="32" y1="6" x2="32" y2="14" stroke="#163a2b" strokeWidth="3" strokeLinecap="round" />
      <circle cx="32" cy="6" r="4" className="iq-antenna" fill="#e8b04a" />
      <rect x="6" y="26" width="6" height="12" rx="3" fill="#163a2b" />
      <rect x="52" y="26" width="6" height="12" rx="3" fill="#163a2b" />
      <rect
        x="10"
        y="14"
        width="44"
        height="40"
        rx="14"
        fill="#fff"
        stroke="#163a2b"
        strokeWidth="3"
      />
      <rect x="16" y="22" width="32" height="20" rx="9" fill="#163a2b" />
      <g className="iq-eyes">
        <ellipse cx="25" cy="32" rx="3.6" ry="4.4" fill="#9fe3c0" />
        <ellipse cx="39" cy="32" rx="3.6" ry="4.4" fill="#9fe3c0" />
      </g>
      <path
        d="M26 47 Q32 51 38 47"
        stroke="#163a2b"
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'CHAT_DISABLED')
      return 'The assistant is switched off right now (no Groq API key is configured). Please try again later.';
    if (err.status === 429)
      return 'You are sending messages too quickly. Please wait a minute and try again.';
  }
  return 'Sorry, I could not answer just now. Please try again.';
}

export function ChatBot() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([GREETING]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' });
  }, [messages, busy, open]);
  useEffect(() => {
    if (open) field.current?.focus();
  }, [open]);

  async function send(content: string) {
    const clean = content.trim();
    if (!clean || busy) return;
    const next = [...messages, { role: 'user' as const, content: clean }];
    setMessages(next);
    setText('');
    setFailed(null);
    setBusy(true);
    try {
      // The greeting is the bot's own text, not part of what the user said; skip it to save tokens.
      const { reply } = await askAssistant(next.slice(1));
      setMessages([...next, { role: 'assistant', content: reply }]);
    } catch (err) {
      setFailed(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send(text);
  }

  return (
    <div className="fixed right-4 bottom-4 z-40 flex flex-col items-end gap-3 sm:right-6 sm:bottom-6">
      {open && (
        <section
          aria-label="IQ assistant"
          className="iq-pop flex h-[min(34rem,calc(100vh-7rem))] w-[min(22rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-2xl sm:w-96"
        >
          <header className="flex items-center gap-3 bg-forest px-4 py-3 text-white">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-forest-soft">
              <Robot size={34} talking={busy} />
            </span>
            <span className="leading-tight">
              <span className="block font-display text-lg">IQ Assistant</span>
              <span className="flex items-center gap-1.5 text-xs text-forest-soft">
                <span className="h-2 w-2 rounded-full bg-emerald-300" /> Online · KYC help
              </span>
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close assistant"
              className="ml-auto rounded-md px-2 py-1 text-xl leading-none hover:bg-white/10"
            >
              ×
            </button>
          </header>

          <div
            className="flex-1 space-y-3 overflow-y-auto bg-ivory px-3 py-4"
            role="log"
            aria-live="polite"
          >
            {messages.map((m, i) => (
              <div key={i} className={cn('flex gap-2', m.role === 'user' && 'justify-end')}>
                {m.role === 'assistant' && <Robot size={28} />}
                <p
                  className={cn(
                    'max-w-[80%] rounded-2xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap',
                    m.role === 'user'
                      ? 'rounded-br-sm bg-forest text-white'
                      : 'rounded-bl-sm border border-line bg-white text-ink',
                  )}
                >
                  {m.content}
                </p>
              </div>
            ))}
            {busy && (
              <div className="flex items-center gap-2" role="status" aria-label="IQ is typing">
                <Robot size={28} talking />
                <span className="flex gap-1 rounded-2xl rounded-bl-sm border border-line bg-white px-3 py-3">
                  <span className="iq-dot" />
                  <span className="iq-dot [animation-delay:150ms]" />
                  <span className="iq-dot [animation-delay:300ms]" />
                </span>
              </div>
            )}
            {failed && (
              <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
                {failed}
              </p>
            )}
            {messages.length === 1 && !busy && (
              <div className="flex flex-wrap gap-2 pt-1">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void send(s)}
                    className="rounded-full border border-forest/30 bg-white px-3 py-1.5 text-xs text-forest hover:bg-forest-soft"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            <div ref={end} />
          </div>

          <form onSubmit={onSubmit} className="flex gap-2 border-t border-line bg-white p-3">
            <label htmlFor="iq-input" className="sr-only">
              Message to IQ
            </label>
            <input
              id="iq-input"
              ref={field}
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={1000}
              autoComplete="off"
              placeholder="Type your question…"
              className="min-w-0 flex-1 rounded-full border border-line bg-ivory px-4 py-2 text-sm outline-none focus:border-forest"
            />
            <button
              type="submit"
              disabled={busy || !text.trim()}
              aria-label="Send message"
              className="grid h-10 w-10 place-items-center rounded-full bg-forest text-white transition hover:bg-forest-deep disabled:opacity-40"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M3 20.5v-6.8l9-1.7-9-1.7V3.5L22 12z" />
              </svg>
            </button>
          </form>
        </section>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? 'Close IQ assistant' : 'Open IQ assistant'}
        className="iq-float group relative grid h-16 w-16 place-items-center rounded-full border-2 border-forest bg-white shadow-xl transition hover:scale-105"
      >
        <Robot size={46} />
        {!open && (
          <span className="absolute -top-1 -right-1 grid h-5 w-5 place-items-center rounded-full bg-amber text-[0.65rem] font-bold text-white">
            ?
          </span>
        )}
      </button>
    </div>
  );
}
