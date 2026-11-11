// PROTOTYPE — throwaway, lives only on the `prototype/avisos-ui` branch.
// Question (wayfinder ticket "Prototipo: cómo se ve y cómo se recibe un aviso"):
// what do the bell + badge, the inbox, the real-time toast and the click
// destination look like? Three structurally different variants, switchable via
// `?variant=A|B|C` on every page of the app layout. State is in memory only;
// "realtime" is simulated from the floating prototype bar.
import {
  createContext,
  useContext,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { Bell, Check, CheckCheck, Inbox, X } from "lucide-react";
import { cn } from "~/lib/utils";

// ─── Model (mirrors the catalog decision) ─────────────────────────────────────

type Kind = "reply-to-you" | "reply-in-thread" | "commented";

type Notice = {
  id: number;
  kind: Kind;
  /** Grouping key: thread (replies) or lesson (top-level comments). */
  groupKey: string;
  actor: string;
  count: number;
  lessonTitle: string;
  courseTitle: string;
  slug: string;
  lessonId: number;
  /** Oldest unread comment in the group — the click anchor. */
  commentId: number;
  snippet: string;
  createdAt: number;
  read: boolean;
};

const min = 60_000;
const now = () => Date.now();

const TS = {
  courseTitle: "Introduction to TypeScript",
  slug: "introduction-to-typescript",
};
const API = {
  courseTitle: "Building REST APIs with Node.js",
  slug: "building-rest-apis-with-nodejs",
};

function seed(): Notice[] {
  const t = now();
  return [
    {
      id: 1,
      kind: "reply-to-you",
      groupKey: "thread-1",
      actor: "Sarah Chen",
      count: 1,
      lessonTitle: "Your First TypeScript Program",
      ...TS,
      lessonId: 3,
      commentId: 2,
      snippet:
        "That usually means TypeScript is installed locally but not on your PATH. Try npx tsc instead…",
      createdAt: t - 4 * min,
      read: false,
    },
    {
      id: 2,
      kind: "commented",
      groupKey: "lesson-22",
      actor: "Liam Thompson",
      count: 3,
      lessonTitle: "HTTP Methods and Status Codes",
      ...API,
      lessonId: 22,
      commentId: 12,
      snippet:
        "When would you return a 422 instead of a 400? The distinction isn't clear to me from the video…",
      createdAt: t - 38 * min,
      read: false,
    },
    {
      id: 3,
      kind: "reply-in-thread",
      groupKey: "thread-6",
      actor: "Emma Wilson",
      count: 1,
      lessonTitle: "Primitive Types",
      ...TS,
      lessonId: 4,
      commentId: 7,
      snippet:
        "I think it only affects the null checks, but I'd like a second opinion on this one.",
      createdAt: t - 3 * 60 * min,
      read: true,
    },
    {
      id: 4,
      kind: "reply-to-you",
      groupKey: "thread-8",
      actor: "Sarah Chen",
      count: 1,
      lessonTitle: "What is TypeScript?",
      ...TS,
      lessonId: 1,
      commentId: 9,
      snippet:
        "Most of it. If you've written JSDoc types you already understand the core ideas.",
      createdAt: t - 26 * 60 * min,
      read: true,
    },
  ];
}

// Queue of "incoming" events the bar can fire. Some share a groupKey with an
// unread notice, to show bursts collapsing into one grouped notice.
const incoming: Omit<Notice, "id" | "createdAt" | "read" | "count">[] = [
  {
    kind: "reply-to-you",
    groupKey: "thread-1",
    actor: "Marcus Johnson",
    lessonTitle: "Your First TypeScript Program",
    ...TS,
    lessonId: 3,
    commentId: 3,
    snippet: "Also worth adding it as an npm script so you never think about it.",
  },
  {
    kind: "reply-in-thread",
    groupKey: "thread-4",
    actor: "Olivia Martinez",
    lessonTitle: "Function Types",
    ...TS,
    lessonId: 8,
    commentId: 4,
    snippet: "Same problem here — it widens to unknown as soon as I add the default.",
  },
  {
    kind: "commented",
    groupKey: "lesson-5",
    actor: "Sophia Davis",
    lessonTitle: "Arrays and Tuples",
    ...TS,
    lessonId: 5,
    commentId: 5,
    snippet: "Is there a reason to prefer interface over type here, or is it style?",
  },
  {
    kind: "commented",
    groupKey: "lesson-22",
    actor: "Noah Blackwood",
    lessonTitle: "HTTP Methods and Status Codes",
    ...API,
    lessonId: 22,
    commentId: 12,
    snippet: "Does 409 count as a client error even if the client did nothing wrong?",
  },
];

type State = { notices: Notice[]; nextId: number; cursor: number; lastEvent: string };
type Action =
  | { type: "read"; id: number }
  | { type: "read-all" }
  | { type: "incoming" }
  | { type: "read-elsewhere" }
  | { type: "reset" };

function init(): State {
  return { notices: seed(), nextId: 100, cursor: 0, lastEvent: "seed" };
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "read":
      return {
        ...state,
        lastEvent: `read #${action.id}`,
        notices: state.notices.map((n) =>
          n.id === action.id ? { ...n, read: true } : n
        ),
      };
    case "read-all":
      return {
        ...state,
        lastEvent: "read all",
        notices: state.notices.map((n) => ({ ...n, read: true })),
      };
    case "read-elsewhere": {
      const target = state.notices.find((n) => !n.read);
      if (!target) return { ...state, lastEvent: "read elsewhere: nothing unread" };
      return {
        ...state,
        lastEvent: `read #${target.id} in another tab`,
        notices: state.notices.map((n) =>
          n.id === target.id ? { ...n, read: true } : n
        ),
      };
    }
    case "incoming": {
      const ev = incoming[state.cursor % incoming.length];
      const cursor = state.cursor + 1;
      const group = state.notices.find(
        (n) => !n.read && n.groupKey === ev.groupKey
      );
      if (group) {
        // Grouped: count goes up, latest snippet/actor, anchor stays oldest.
        const updated = {
          ...group,
          count: group.count + 1,
          actor: ev.actor,
          snippet: ev.snippet,
          createdAt: now(),
        };
        return {
          ...state,
          cursor,
          lastEvent: `incoming → grouped into #${group.id} (${updated.count})`,
          notices: [updated, ...state.notices.filter((n) => n.id !== group.id)],
        };
      }
      const fresh: Notice = {
        ...ev,
        id: state.nextId,
        count: 1,
        createdAt: now(),
        read: false,
      };
      return {
        ...state,
        cursor,
        nextId: state.nextId + 1,
        lastEvent: `incoming → new #${fresh.id}`,
        notices: [fresh, ...state.notices],
      };
    }
    case "reset":
      return init();
  }
}

/** ?variant= wins; otherwise remember the last one so sidebar links keep it. */
function useVariant(): string {
  const [params] = useSearchParams();
  const fromUrl = params.get("variant");
  const [remembered, setRemembered] = useState<string | null>(null);
  useEffect(() => {
    try {
      if (fromUrl) sessionStorage.setItem("prototype-variant", fromUrl);
      else setRemembered(sessionStorage.getItem("prototype-variant"));
    } catch {}
  }, [fromUrl]);
  return (fromUrl ?? remembered ?? "A").toUpperCase();
}

type Ctx = {
  state: State;
  dispatch: React.Dispatch<Action>;
  unread: number;
  /** The notice that just arrived (for toasts), bumped on every incoming. */
  latest: { notice: Notice; seq: number } | null;
  open: (n: Notice) => void;
};

const NoticesCtx = createContext<Ctx | null>(null);
const useNotices = () => useContext(NoticesCtx)!;

export function NoticesPrototypeProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, init);
  const [latest, setLatest] = useState<Ctx["latest"]>(null);
  const navigate = useNavigate();
  const variant = useVariant();
  const prevCursor = useRef(state.cursor);

  useEffect(() => {
    if (state.cursor !== prevCursor.current) {
      prevCursor.current = state.cursor;
      setLatest({ notice: state.notices[0], seq: state.cursor });
    }
  }, [state.cursor, state.notices]);

  function open(n: Notice) {
    dispatch({ type: "read", id: n.id });
    navigate(
      `/courses/${n.slug}/lessons/${n.lessonId}?variant=${variant}#comment-${n.commentId}`
    );
  }

  const unread = state.notices.filter((n) => !n.read).length;
  return (
    <NoticesCtx.Provider value={{ state, dispatch, unread, latest, open }}>
      {children}
    </NoticesCtx.Provider>
  );
}

// ─── Shared bits ──────────────────────────────────────────────────────────────

function headline(n: Notice) {
  if (n.count > 1) {
    return {
      "reply-to-you": `${n.count} new replies to your comment`,
      "reply-in-thread": `${n.count} new replies in a thread`,
      commented: `${n.count} new comments`,
    }[n.kind];
  }
  return {
    "reply-to-you": `${n.actor} replied to your comment`,
    "reply-in-thread": `${n.actor} replied in a thread`,
    commented: `${n.actor} commented`,
  }[n.kind];
}

function ago(t: number) {
  const m = Math.round((now() - t) / min);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

function Initials({ name, className }: { name: string; className?: string }) {
  const i = name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2);
  return (
    <div
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary",
        className
      )}
    >
      {i}
    </div>
  );
}

function Badge({ n, className }: { n: number; className?: string }) {
  if (n === 0) return null;
  return (
    <span
      className={cn(
        "flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white",
        className
      )}
    >
      {n > 9 ? "9+" : n}
    </span>
  );
}

// ─── Variant A: bell in the sidebar header → dropdown popover; sonner toast ───

function VariantA() {
  const { state, dispatch, unread, latest, open } = useNotices();
  const [isOpen, setOpen] = useState(false);

  useEffect(() => {
    if (!latest) return;
    const n = latest.notice;
    toast(headline(n), {
      description: `${n.lessonTitle} — “${n.snippet.slice(0, 60)}…”`,
      action: { label: "View", onClick: () => open(n) },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest?.seq]);

  return (
    <div className="fixed left-[10.5rem] top-3.5 z-40">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-md p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent"
        title="Notifications"
      >
        <Bell className="size-4" />
        <Badge n={unread} className="absolute -right-1 -top-1" />
      </button>
      {isOpen && (
        <>
          <div className="fixed inset-0" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-9 w-96 overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-xl">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <span className="text-sm font-semibold">Notifications</span>
              <button
                disabled={unread === 0}
                onClick={() => dispatch({ type: "read-all" })}
                className="text-xs font-medium text-primary hover:underline disabled:text-muted-foreground disabled:no-underline"
              >
                Mark all as read
              </button>
            </div>
            <ul className="max-h-[28rem] divide-y overflow-y-auto">
              {state.notices.length === 0 && (
                <li className="p-8 text-center text-sm text-muted-foreground">
                  You're all caught up.
                </li>
              )}
              {state.notices.map((n) => (
                <li key={n.id}>
                  <button
                    onClick={() => {
                      setOpen(false);
                      open(n);
                    }}
                    className={cn(
                      "flex w-full gap-3 px-4 py-3 text-left hover:bg-accent",
                      !n.read && "bg-primary/5"
                    )}
                  >
                    <Initials name={n.actor} />
                    <div className="min-w-0 flex-1">
                      <p className={cn("text-sm", !n.read && "font-semibold")}>
                        {headline(n)} on <em>{n.lessonTitle}</em>
                      </p>
                      <p className="text-xs text-muted-foreground">{n.courseTitle}</p>
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                        {n.snippet}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <span className="text-[11px] text-muted-foreground">
                        {ago(n.createdAt)}
                      </span>
                      {!n.read && <span className="size-2 rounded-full bg-primary" />}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Variant B: "Inbox" nav entry → right drawer with tabs; banner, no toast ──

function VariantB() {
  const { state, dispatch, unread, latest, open } = useNotices();
  const [isOpen, setOpen] = useState(false);
  const [tab, setTab] = useState<"unread" | "all">("unread");
  const [banner, setBanner] = useState<Notice | null>(null);

  useEffect(() => {
    if (!latest || isOpen) return;
    setBanner(latest.notice);
    const t = setTimeout(() => setBanner(null), 8000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest?.seq]);

  const list = state.notices.filter((n) => tab === "all" || !n.read);
  const byCourse = new Map<string, Notice[]>();
  for (const n of list) {
    byCourse.set(n.courseTitle, [...(byCourse.get(n.courseTitle) ?? []), n]);
  }

  return (
    <>
      {/* Sits over the sidebar nav, just under the header, like a nav item. */}
      <button
        onClick={() => setOpen(true)}
        className="fixed left-3 top-[3.75rem] z-40 flex w-[12.5rem] items-center gap-3 rounded-md bg-sidebar px-3 py-2 text-sm font-medium text-sidebar-foreground/70 ring-1 ring-sidebar-border hover:bg-sidebar-accent"
      >
        <Inbox className={cn("size-4", banner && "animate-bounce text-primary")} />
        Inbox
        <Badge n={unread} className="ml-auto h-5 min-w-5 text-xs" />
      </button>

      {banner && (
        <div className="fixed left-1/2 top-0 z-40 ml-28 flex -translate-x-1/2 items-center gap-3 rounded-b-lg border border-t-0 bg-background px-4 py-2 text-sm shadow-md">
          <span className="size-2 rounded-full bg-primary" />
          <span>
            <strong>{headline(banner)}</strong> on {banner.lessonTitle}
          </span>
          <button
            onClick={() => {
              setBanner(null);
              open(banner);
            }}
            className="font-medium text-primary hover:underline"
          >
            View
          </button>
          <button onClick={() => setBanner(null)} className="text-muted-foreground">
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {isOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={() => setOpen(false)}>
          <aside
            onClick={(e) => e.stopPropagation()}
            className="flex h-full w-[26rem] flex-col border-l bg-background shadow-2xl"
          >
            <header className="flex items-center justify-between border-b px-5 py-4">
              <h2 className="text-lg font-semibold">Inbox</h2>
              <button onClick={() => setOpen(false)} className="text-muted-foreground">
                <X className="size-5" />
              </button>
            </header>
            <div className="flex gap-1 border-b px-5 py-2">
              {(["unread", "all"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={cn(
                    "rounded-full px-3 py-1 text-sm capitalize",
                    tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
                  )}
                >
                  {t}
                  {t === "unread" && unread > 0 && ` (${unread})`}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-3">
              {list.length === 0 && (
                <div className="mt-20 text-center text-muted-foreground">
                  <CheckCheck className="mx-auto mb-2 size-8" />
                  Nothing new. Back to learning.
                </div>
              )}
              {[...byCourse].map(([course, items]) => (
                <section key={course} className="mb-5">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {course}
                  </h3>
                  <div className="space-y-2">
                    {items.map((n) => (
                      <div
                        key={n.id}
                        className={cn(
                          "group rounded-lg border p-3",
                          !n.read && "border-l-4 border-l-primary"
                        )}
                      >
                        <button
                          onClick={() => {
                            setOpen(false);
                            open(n);
                          }}
                          className="w-full text-left"
                        >
                          <div className="flex items-baseline justify-between gap-2">
                            <p className={cn("text-sm", !n.read && "font-semibold")}>
                              {headline(n)}
                            </p>
                            <span className="shrink-0 text-[11px] text-muted-foreground">
                              {ago(n.createdAt)}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground">on {n.lessonTitle}</p>
                          <blockquote className="mt-2 border-l-2 pl-2 text-xs italic text-muted-foreground line-clamp-2">
                            {n.snippet}
                          </blockquote>
                        </button>
                        {!n.read && (
                          <button
                            onClick={() => dispatch({ type: "read", id: n.id })}
                            className="mt-2 hidden items-center gap-1 text-xs text-primary group-hover:flex"
                          >
                            <Check className="size-3" /> Mark as read
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
            <footer className="border-t px-5 py-3">
              <button
                disabled={unread === 0}
                onClick={() => dispatch({ type: "read-all" })}
                className="w-full rounded-md border py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
              >
                Mark all as read
              </button>
            </footer>
          </aside>
        </div>
      )}
    </>
  );
}

// ─── Variant C: always-visible activity feed in the sidebar + modal; card
//     toast anchored to it ─────────────────────────────────────────────────────

function VariantC() {
  const { state, dispatch, unread, latest, open } = useNotices();
  const [modal, setModal] = useState(false);
  const [popped, setPopped] = useState<Notice | null>(null);

  useEffect(() => {
    if (!latest) return;
    setPopped(latest.notice);
    const t = setTimeout(() => setPopped(null), 6000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest?.seq]);

  const top = state.notices.filter((n) => !n.read).slice(0, 3);

  return (
    <>
      {/* Docked at the bottom of the sidebar, above the user footer. */}
      <div className="fixed bottom-[7.5rem] left-0 z-40 w-56 border-y border-sidebar-border bg-sidebar p-3">
        <div className="mb-2 flex items-center justify-between px-1">
          <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/50">
            Activity <Badge n={unread} />
          </span>
          <button onClick={() => setModal(true)} className="text-xs text-primary hover:underline">
            See all
          </button>
        </div>
        {top.length === 0 ? (
          <p className="px-1 text-xs text-sidebar-foreground/50">All caught up ✓</p>
        ) : (
          <ul className="space-y-1">
            {top.map((n) => (
              <li key={n.id}>
                <button
                  onClick={() => open(n)}
                  className={cn(
                    "w-full rounded-md px-2 py-1.5 text-left hover:bg-sidebar-accent",
                    popped?.id === n.id && "bg-primary/10 ring-1 ring-primary/40"
                  )}
                >
                  <p className="truncate text-xs font-medium">{headline(n)}</p>
                  <p className="truncate text-[11px] text-sidebar-foreground/50">
                    {n.lessonTitle} · {ago(n.createdAt)}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {popped && (
        <div className="fixed bottom-[9rem] left-[14.5rem] z-50 w-80 rounded-xl border bg-background p-4 shadow-2xl">
          <div className="absolute -left-2 bottom-6 size-4 rotate-45 border-b border-l bg-background" />
          <div className="flex gap-3">
            <Initials name={popped.actor} className="size-10 text-sm" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{headline(popped)}</p>
              <p className="text-xs text-muted-foreground">
                {popped.lessonTitle} · {popped.courseTitle}
              </p>
              <p className="mt-2 line-clamp-3 text-sm">{popped.snippet}</p>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => {
                    setPopped(null);
                    open(popped);
                  }}
                  className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground"
                >
                  Go to comment
                </button>
                <button
                  onClick={() => {
                    dispatch({ type: "read", id: popped.id });
                    setPopped(null);
                  }}
                  className="rounded-md px-3 py-1 text-xs text-muted-foreground hover:bg-accent"
                >
                  Mark read
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setModal(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[80vh] w-[40rem] flex-col rounded-xl bg-background shadow-2xl"
          >
            <header className="flex items-center justify-between border-b px-6 py-4">
              <h2 className="text-lg font-semibold">All activity</h2>
              <div className="flex items-center gap-3">
                <button
                  disabled={unread === 0}
                  onClick={() => dispatch({ type: "read-all" })}
                  className="text-sm text-primary hover:underline disabled:text-muted-foreground"
                >
                  Mark all as read
                </button>
                <button onClick={() => setModal(false)}>
                  <X className="size-5" />
                </button>
              </div>
            </header>
            <table className="w-full text-sm">
              <tbody>
                {state.notices.map((n) => (
                  <tr
                    key={n.id}
                    onClick={() => {
                      setModal(false);
                      open(n);
                    }}
                    className={cn("cursor-pointer border-b hover:bg-accent", n.read && "text-muted-foreground")}
                  >
                    <td className="w-6 pl-6">{!n.read && <span className="block size-2 rounded-full bg-primary" />}</td>
                    <td className="py-3 pr-3">
                      <span className={cn(!n.read && "font-semibold")}>{headline(n)}</span>
                      <div className="text-xs text-muted-foreground line-clamp-1">{n.snippet}</div>
                    </td>
                    <td className="py-3 pr-3 text-xs">{n.lessonTitle}</td>
                    <td className="py-3 pr-6 text-right text-xs">{ago(n.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Switcher + simulator bar ────────────────────────────────────────────────

const VARIANTS = {
  A: "Campanita + dropdown + toast",
  B: "Inbox en nav + drawer + banner",
  C: "Feed en sidebar + modal + tarjeta",
} as const;
type Key = keyof typeof VARIANTS;
const KEYS = Object.keys(VARIANTS) as Key[];

function PrototypeBar({ current }: { current: Key }) {
  const { state, dispatch, unread } = useNotices();
  const [params, setParams] = useSearchParams();

  function go(delta: number) {
    const i = (KEYS.indexOf(current) + delta + KEYS.length) % KEYS.length;
    const next = new URLSearchParams(params);
    next.set("variant", KEYS[i]);
    setParams(next, { replace: true, preventScrollReset: true });
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, [contenteditable]")) return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const btn = "rounded-full px-2.5 py-1 hover:bg-white/15";
  return (
    <div className="fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-1 rounded-full bg-zinc-900 px-2 py-1.5 text-xs text-white shadow-2xl ring-2 ring-fuchsia-500">
      <span className="px-2 font-bold text-fuchsia-400">PROTOTYPE</span>
      <button className={btn} onClick={() => go(-1)}>←</button>
      <span className="min-w-52 text-center font-medium">
        {current} ({VARIANTS[current]})
      </span>
      <button className={btn} onClick={() => go(1)}>→</button>
      <span className="mx-1 h-4 w-px bg-white/30" />
      <button className={btn} onClick={() => dispatch({ type: "incoming" })}>
        ⚡ Llega un aviso
      </button>
      <button className={btn} onClick={() => dispatch({ type: "read-elsewhere" })}>
        Leído en otra pestaña
      </button>
      <button className={btn} onClick={() => dispatch({ type: "reset" })}>
        Reiniciar
      </button>
      <span className="mx-1 h-4 w-px bg-white/30" />
      <span className="px-2 font-mono text-[11px] text-white/70">
        {unread} sin leer / {state.notices.length} · {state.lastEvent}
      </span>
    </div>
  );
}

export function NoticesPrototype() {
  const raw = useVariant();
  if (import.meta.env.PROD) return null;
  const current: Key = (KEYS as string[]).includes(raw) ? (raw as Key) : "A";
  return (
    <>
      {current === "A" && <VariantA />}
      {current === "B" && <VariantB />}
      {current === "C" && <VariantC />}
      <PrototypeBar current={current} />
    </>
  );
}
