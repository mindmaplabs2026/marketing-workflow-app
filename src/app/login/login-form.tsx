"use client";

import { useActionState, useState } from "react";
import {
  ArrowRight,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Eye,
  EyeOff,
  FileText,
  Link2,
  Lock,
  Mail,
  PenLine,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { signInWithPassword, type ActionState } from "./actions";

const initialState: ActionState = {};
const TEMP_PASSWORD_KEY = "mwa_initial_pwd";

export type LoginWorkflowStep = {
  title: string;
  school: string;
  status: string;
  time: string;
};

const fallbackWorkflowSteps: LoginWorkflowStep[] = [
  {
    title: "Request submitted",
    school: "New requests entering the queue",
    status: "Submitted",
    time: "2m ago",
  },
  {
    title: "With design team",
    school: "Active work with the design team",
    status: "In progress",
    time: "15m ago",
  },
  {
    title: "Awaiting approval",
    school: "Designs waiting for review",
    status: "Pending",
    time: "1h ago",
  },
  {
    title: "Published",
    school: "Live posts across channels",
    status: "Live",
    time: "3h ago",
  },
];

const workflowVisuals = [
  {
    icon: FileText,
    tone: "violet",
    offset: "ml-0",
    mobileLabel: "Submitted",
  },
  {
    icon: PenLine,
    tone: "blue",
    offset: "ml-10",
    mobileLabel: "With design\nteam",
  },
  {
    icon: UsersRound,
    tone: "amber",
    offset: "ml-16",
    mobileLabel: "Approval",
  },
  {
    icon: CheckCircle2,
    tone: "emerald",
    offset: "ml-24",
    mobileLabel: "Published",
  },
] as const;

const productHighlights = [
  {
    title: "Centralized requests",
    body: "Collect, track, and organize all school marketing requests.",
    icon: BarChart3,
  },
  {
    title: "Smart approvals",
    body: "Keep every stakeholder aligned with clear approval flows.",
    icon: CheckCircle2,
  },
  {
    title: "Plan with confidence",
    body: "Schedule campaigns and stay ahead of important dates.",
    icon: CalendarDays,
  },
  {
    title: "Published, everywhere",
    body: "Track live links across channels from one workspace.",
    icon: Link2,
  },
] as const;

const toneClass = {
  violet: {
    icon: "bg-violet-100 text-violet-700",
    mobileText: "text-violet-700",
    chip: "bg-violet-100 text-violet-700",
    rail: "bg-violet-600",
  },
  blue: {
    icon: "bg-blue-100 text-blue-700",
    mobileText: "text-blue-700",
    chip: "bg-blue-100 text-blue-700",
    rail: "bg-blue-600",
  },
  amber: {
    icon: "bg-amber-100 text-amber-700",
    mobileText: "text-orange-500",
    chip: "bg-amber-100 text-amber-700",
    rail: "bg-amber-500",
  },
  emerald: {
    icon: "bg-emerald-100 text-emerald-700",
    mobileText: "text-green-700",
    chip: "bg-emerald-100 text-emerald-700",
    rail: "bg-emerald-500",
  },
} as const;

async function dispatchSignIn(
  prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (typeof window !== "undefined") {
    const pwd = String(formData.get("password") ?? "");
    if (pwd) sessionStorage.setItem(TEMP_PASSWORD_KEY, pwd);

    const remember = formData.get("remember") === "on";
    const email = String(formData.get("email") ?? "").trim();
    if (remember && email) {
      localStorage.setItem("mwa_remember_email", email);
    } else {
      localStorage.removeItem("mwa_remember_email");
    }
  }
  return signInWithPassword(prev, formData);
}

export function LoginForm({
  initialError,
  workflowSteps = fallbackWorkflowSteps,
}: {
  initialError?: string;
  workflowSteps?: LoginWorkflowStep[];
}) {
  const [state, formAction, pending] = useActionState(
    dispatchSignIn,
    initialState,
  );
  const [showPassword, setShowPassword] = useState(false);
  const errorMessage = state.error ?? initialError;

  return (
    <main className="min-h-dvh overflow-y-auto bg-[radial-gradient(circle_at_10%_10%,rgba(124,58,237,0.08),transparent_28%),linear-gradient(135deg,#ffffff_0%,#fbf8ff_44%,#eef6ff_100%)] text-zinc-950 lg:h-dvh lg:overflow-hidden">
      <div className="mx-auto grid min-h-dvh w-full max-w-[1440px] grid-cols-1 lg:h-dvh lg:grid-cols-[minmax(430px,0.88fr)_minmax(0,1.12fr)]">
        <section className="relative min-h-dvh overflow-hidden px-4 pb-4 pt-4 lg:hidden">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_82%_8%,rgba(124,58,237,0.18),transparent_28%),radial-gradient(circle_at_58%_42%,rgba(59,130,246,0.13),transparent_34%),linear-gradient(160deg,#ffffff_0%,#f7f2ff_45%,#eef7ff_100%)]" />
          <div className="absolute -right-28 top-48 h-72 w-[28rem] rotate-[-16deg] rounded-full border border-white/70" />
          <div className="absolute -left-28 top-72 h-64 w-[34rem] rotate-[-10deg] rounded-full border border-white/60" />
          <div className="absolute -left-16 top-[300px] h-32 w-52 opacity-55 [background-image:radial-gradient(circle,rgba(255,255,255,0.95)_1.5px,transparent_1.5px)] [background-size:18px_18px]" />
          <div className="absolute -left-16 top-[272px] h-24 w-[38rem] rotate-[8deg] rounded-full bg-[linear-gradient(100deg,transparent_0%,rgba(124,58,237,0.18)_38%,rgba(96,165,250,0.16)_72%,transparent_100%)] blur-[1px]" />
          <svg
            aria-hidden="true"
            className="absolute -left-14 top-[240px] h-48 w-[40rem] text-white"
            viewBox="0 0 640 192"
            fill="none"
            preserveAspectRatio="none"
          >
            <path
              d="M-18 86 C72 58 128 42 218 62 C322 85 380 128 500 102 C574 86 610 52 666 34"
              stroke="currentColor"
              strokeWidth="3"
              opacity="0.95"
            />
            <path
              d="M-22 122 C82 88 142 76 234 92 C338 111 398 150 514 126 C578 112 620 82 668 62"
              stroke="currentColor"
              strokeWidth="2"
              opacity="0.7"
            />
          </svg>
          <div className="absolute -bottom-20 -right-16 h-64 w-80 rounded-full bg-blue-200/25 blur-3xl" />
          <div className="absolute right-8 top-28 h-28 w-36 opacity-55 [background-image:radial-gradient(circle,rgba(255,255,255,0.95)_1.4px,transparent_1.4px)] [background-size:22px_22px]" />

          <div className="relative mx-auto flex w-full max-w-[430px] flex-col">
            <div className="flex items-center gap-3 px-4 pt-1">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600 to-blue-600 text-2xl font-black text-white shadow-[0_16px_30px_rgba(124,58,237,0.26)] ring-1 ring-white/70">
                M
              </span>
              <span className="text-xl font-semibold tracking-tight text-zinc-950">
                Mindmap Workflow
              </span>
            </div>

            <div className="relative h-[220px]">
              <svg
                aria-hidden="true"
                className="absolute inset-x-0 top-0 h-[180px] w-full overflow-visible"
                viewBox="0 0 430 180"
                fill="none"
              >
                <path
                  d="M22 121 C42 111 66 111 90 121"
                  stroke="#7c3aed"
                  strokeWidth="3.7"
                  strokeDasharray="5 10"
                  strokeLinecap="round"
                />
                <path
                  d="M90 121 C110 128 116 74 125 61"
                  stroke="#3b82f6"
                  strokeWidth="3.7"
                  strokeDasharray="5 10"
                  strokeLinecap="round"
                />
                <path
                  d="M193 61 C214 66 219 91 228 97"
                  stroke="#f59e0b"
                  strokeWidth="3.7"
                  strokeDasharray="5 10"
                  strokeLinecap="round"
                />
                <path
                  d="M296 97 C318 106 324 134 323 143"
                  stroke="#16a34a"
                  strokeWidth="3.7"
                  strokeDasharray="5 10"
                  strokeLinecap="round"
                />
                <path
                  d="M-24 164 C84 128 135 128 220 146 C300 166 354 146 454 102"
                  stroke="white"
                  strokeWidth="2.5"
                  opacity="1"
                />
              </svg>

              {workflowVisuals.map((visual, index) => {
                const step = workflowSteps[index] ?? fallbackWorkflowSteps[index];
                const Icon = visual.icon;
                const tone = toneClass[visual.tone];
                const positions = [
                  "left-[5%] top-[80px] -rotate-6",
                  "left-[29%] top-[20px] rotate-0",
                  "left-[53%] top-[56px] rotate-3",
                  "left-[75%] top-[102px] rotate-6",
                ];
                return (
                  <div
                    key={step.title}
                    className={`absolute flex h-[82px] w-[68px] flex-col items-center justify-center rounded-2xl border border-white/80 bg-white/82 shadow-[0_14px_30px_rgba(91,33,182,0.13),inset_0_1px_0_rgba(255,255,255,0.92)] backdrop-blur-xl ${positions[index]}`}
                  >
                    <span
                      className={`mb-1.5 flex h-8 w-8 items-center justify-center rounded-full ${tone.icon}`}
                    >
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <span
                      className={`max-w-[4rem] whitespace-pre-line text-center text-[10px] font-semibold leading-tight ${tone.mobileText}`}
                    >
                      {visual.mobileLabel}
                    </span>
                  </div>
                );
              })}

              <span className="absolute left-[5%] top-[121px] z-30 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white bg-violet-500" />
              <span className="absolute left-[calc(5%_+_68px)] top-[121px] z-30 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white bg-violet-500" />
              <span className="absolute left-[29%] top-[61px] z-30 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white bg-blue-400" />
              <span className="absolute left-[calc(29%_+_68px)] top-[61px] z-30 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white bg-blue-400" />
              <span className="absolute left-[53%] top-[97px] z-30 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white bg-amber-500" />
              <span className="absolute left-[calc(53%_+_68px)] top-[97px] z-30 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white bg-amber-500" />
              <span className="absolute left-[75%] top-[143px] z-30 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white bg-emerald-500" />
            </div>

            <div className="relative mt-9 rounded-[24px] border border-white/80 bg-white/92 p-5 shadow-[0_24px_70px_rgba(15,23,42,0.14),inset_0_1px_0_rgba(255,255,255,0.94)] backdrop-blur-xl">
              <h1 className="text-[32px] font-semibold leading-tight text-zinc-950">
                Welcome back
              </h1>
              <p className="mt-3 text-sm leading-6 text-zinc-600">
                Manage school marketing requests, approvals, and published
                posts in one place.
              </p>

              <form action={formAction} className="mt-5 space-y-3">
                <div>
                  <label
                    htmlFor="email-mobile"
                    className="block text-sm font-semibold text-zinc-900"
                  >
                    Email address
                  </label>
                  <div className="mt-2 flex items-center rounded-xl border border-zinc-300/90 bg-white px-3 shadow-[0_8px_22px_rgba(15,23,42,0.05)] transition focus-within:border-violet-500 focus-within:ring-4 focus-within:ring-violet-500/15">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
                      <Mail className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <input
                      id="email-mobile"
                      name="email"
                      type="email"
                      autoComplete="email"
                      required
                      className="min-w-0 flex-1 bg-transparent px-3 py-3 text-sm text-zinc-950 outline-none placeholder:text-zinc-400"
                      placeholder="you@example.com"
                      defaultValue={
                        typeof window === "undefined"
                          ? ""
                          : localStorage.getItem("mwa_remember_email") ?? ""
                      }
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="password-mobile"
                    className="block text-sm font-semibold text-zinc-900"
                  >
                    Password
                  </label>
                  <div className="mt-2 flex items-center rounded-xl border border-zinc-300/90 bg-white px-3 shadow-[0_8px_22px_rgba(15,23,42,0.05)] transition focus-within:border-violet-500 focus-within:ring-4 focus-within:ring-violet-500/15">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
                      <Lock className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <input
                      id="password-mobile"
                      name="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      required
                      className="min-w-0 flex-1 bg-transparent px-3 py-3 text-sm text-zinc-950 outline-none placeholder:text-zinc-400"
                      placeholder="Enter your password"
                    />
                    <button
                      type="button"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      onClick={() => setShowPassword((value) => !value)}
                      className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 focus:outline-none focus:ring-2 focus:ring-violet-500"
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <Eye className="h-4 w-4" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-zinc-600">
                    <input
                      name="remember"
                      type="checkbox"
                      defaultChecked
                      className="h-4 w-4 rounded border-zinc-300 text-violet-600 focus:ring-violet-500"
                    />
                    Remember me
                  </label>
                  <a
                    href="mailto:support@mindmaplabs.com?subject=Mindmap%20Workflow%20password%20help"
                    className="text-sm font-semibold text-violet-600 transition hover:text-violet-700"
                  >
                    Forgot password?
                  </a>
                </div>

                {errorMessage && (
                  <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 animate-[auth-form-enter_220ms_ease-out_both] motion-reduce:animate-none">
                    {errorMessage}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={pending}
                  className="group relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-gradient-to-r from-violet-700 to-blue-600 px-5 py-3 text-base font-semibold text-white shadow-[0_18px_36px_rgba(79,70,229,0.28)] transition hover:-translate-y-0.5 hover:shadow-[0_22px_44px_rgba(79,70,229,0.32)] disabled:cursor-not-allowed disabled:translate-y-0 disabled:opacity-65 motion-reduce:transform-none"
                >
                  <span>{pending ? "Signing in..." : "Sign in"}</span>
                  <ArrowRight className="h-5 w-5 transition group-hover:translate-x-0.5" />
                  {pending && (
                    <span className="absolute inset-y-0 left-0 w-1/2 animate-[navigation-progress_950ms_ease-in-out_infinite] rounded-r-full bg-white/20" />
                  )}
                </button>
              </form>

              <div className="mt-4 flex items-center gap-3 rounded-xl border border-violet-100 bg-violet-50/75 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-violet-700 shadow-sm">
                  <ShieldCheck className="h-5 w-5" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-violet-700">
                    Need help?
                  </p>
                  <p className="mt-0.5 text-xs leading-4 text-zinc-600">
                    Contact your administrator if you are having trouble signing in.
                  </p>
                </div>
                <ArrowRight className="h-5 w-5 shrink-0 text-zinc-500" />
              </div>
            </div>
          </div>
        </section>

        <section className="hidden min-h-dvh items-center px-4 py-4 sm:px-8 lg:flex lg:min-h-0 lg:items-start lg:px-10 lg:py-4">
          <div className="w-full rounded-[24px] border border-white/80 bg-white/92 p-5 shadow-[0_24px_80px_rgba(15,23,42,0.12),inset_0_1px_0_rgba(255,255,255,0.9)] backdrop-blur-xl sm:p-8 lg:max-w-[560px] lg:origin-top-left lg:p-8 xl:p-9 [@media(max-height:760px)]:scale-[0.84]">
            <div className="mb-6 flex items-center gap-3 sm:mb-8 sm:gap-4">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 to-blue-600 text-base font-black text-white shadow-[0_14px_30px_rgba(124,58,237,0.28)] ring-1 ring-white/60 sm:h-11 sm:w-11 sm:text-lg">
                M
              </span>
              <span className="text-xl font-semibold tracking-tight text-zinc-950 sm:text-2xl">
                Mindmap Workflow
              </span>
            </div>

            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-zinc-950 sm:text-4xl xl:text-5xl">
                Welcome back
              </h1>
              <p className="mt-3 max-w-md text-sm leading-6 text-zinc-600 sm:mt-4 sm:text-base sm:leading-7">
                Manage school marketing requests, approvals, and published
                posts in one place.
              </p>
            </div>

            <form action={formAction} className="mt-5 space-y-3 sm:mt-7 sm:space-y-4">
              <div>
                <label
                  htmlFor="email"
                  className="block text-sm font-semibold text-zinc-800"
                >
                  Email address
                </label>
                <div className="mt-2 flex items-center rounded-xl border border-zinc-300/90 bg-white px-4 shadow-[0_6px_18px_rgba(15,23,42,0.04)] transition focus-within:border-violet-500 focus-within:ring-4 focus-within:ring-violet-500/15">
                  <Mail className="h-5 w-5 text-zinc-500" aria-hidden="true" />
                  <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    className="min-w-0 flex-1 bg-transparent px-4 py-2.5 text-sm text-zinc-950 outline-none placeholder:text-zinc-400 sm:py-3"
                    placeholder="you@example.com"
                    defaultValue={
                      typeof window === "undefined"
                        ? ""
                        : localStorage.getItem("mwa_remember_email") ?? ""
                    }
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="password"
                  className="block text-sm font-semibold text-zinc-800"
                >
                  Password
                </label>
                <div className="mt-2 flex items-center rounded-xl border border-zinc-300/90 bg-white px-4 shadow-[0_6px_18px_rgba(15,23,42,0.04)] transition focus-within:border-violet-500 focus-within:ring-4 focus-within:ring-violet-500/15">
                  <Lock className="h-5 w-5 text-zinc-500" aria-hidden="true" />
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    className="min-w-0 flex-1 bg-transparent px-4 py-2.5 text-sm text-zinc-950 outline-none placeholder:text-zinc-400 sm:py-3"
                    placeholder="Enter your password"
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    onClick={() => setShowPassword((value) => !value)}
                    className="rounded-md p-1 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 focus:outline-none focus:ring-2 focus:ring-violet-500"
                  >
                    {showPassword ? (
                      <EyeOff className="h-5 w-5" aria-hidden="true" />
                    ) : (
                      <Eye className="h-5 w-5" aria-hidden="true" />
                    )}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between gap-4">
                <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-zinc-600">
                  <input
                    name="remember"
                    type="checkbox"
                    className="h-4 w-4 rounded border-zinc-300 text-violet-600 focus:ring-violet-500"
                  />
                  Remember me
                </label>
                <a
                  href="mailto:support@mindmaplabs.com?subject=Mindmap%20Workflow%20password%20help"
                  className="text-sm font-semibold text-violet-600 transition hover:text-violet-700"
                >
                  Forgot password?
                </a>
              </div>

              {errorMessage && (
                <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 animate-[auth-form-enter_220ms_ease-out_both] motion-reduce:animate-none">
                  {errorMessage}
                </p>
              )}

              <button
                type="submit"
                disabled={pending}
                className="group relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-gradient-to-r from-violet-700 to-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-[0_16px_32px_rgba(79,70,229,0.24)] transition hover:-translate-y-0.5 hover:shadow-[0_20px_38px_rgba(79,70,229,0.32)] disabled:cursor-not-allowed disabled:translate-y-0 disabled:opacity-65 motion-reduce:transform-none sm:py-3.5"
              >
                <span>{pending ? "Signing in..." : "Sign in"}</span>
                <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                {pending && (
                  <span className="absolute inset-y-0 left-0 w-1/2 animate-[navigation-progress_950ms_ease-in-out_infinite] rounded-r-full bg-white/20" />
                )}
              </button>

            </form>

            <div className="mt-5 rounded-xl border border-violet-100 bg-violet-50/75 p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] sm:mt-6 sm:p-4">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-violet-700 shadow-sm">
                  <ShieldCheck className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-violet-700">
                    Need help?
                  </p>
                  <p className="mt-1 text-sm leading-5 text-zinc-600">
                    Contact your administrator if you are having trouble signing
                    in.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="relative -ml-16 hidden min-h-0 overflow-hidden px-8 py-5 lg:block xl:-ml-20 xl:px-10">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_12%,rgba(124,58,237,0.20),transparent_30%),radial-gradient(circle_at_92%_80%,rgba(37,99,235,0.18),transparent_34%)]" />
          <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.72),rgba(237,233,254,0.62),rgba(219,234,254,0.72))]" />
          <div className="absolute -right-40 top-12 h-[620px] w-[760px] rounded-full bg-[radial-gradient(circle,rgba(124,58,237,0.24),rgba(96,165,250,0.18)_42%,transparent_68%)] blur-sm" />
          <div className="absolute -right-28 top-[18%] h-[520px] w-[720px] rounded-full border border-white/55 opacity-80" />
          <div className="absolute -right-12 top-[30%] h-[390px] w-[560px] rounded-full border border-white/35 opacity-70" />
          <div className="absolute -right-20 bottom-0 h-64 w-[660px] rounded-tl-[240px] bg-[linear-gradient(135deg,transparent_0%,rgba(124,58,237,0.12)_42%,rgba(37,99,235,0.18)_100%)]" />
          <div className="absolute right-5 top-14 h-32 w-44 opacity-55 [background-image:radial-gradient(circle,rgba(255,255,255,0.95)_1.5px,transparent_1.5px)] [background-size:22px_22px]" />
          <svg
            aria-hidden="true"
            className="absolute inset-y-0 right-0 h-full w-full text-white/55"
            viewBox="0 0 820 720"
            fill="none"
            preserveAspectRatio="none"
          >
            <path
              d="M318 556 C430 460 544 440 820 222"
              stroke="currentColor"
              strokeWidth="1.4"
            />
            <path
              d="M248 640 C398 530 576 520 820 378"
              stroke="currentColor"
              strokeWidth="1"
              opacity="0.65"
            />
          </svg>
          <div className="absolute bottom-16 left-12 right-12 h-40 rounded-[32px] bg-white/30 blur-2xl" />

          <div className="relative ml-0 mr-auto flex h-full max-w-3xl origin-top flex-col justify-start pt-4 xl:pt-6 [@media(max-height:760px)]:scale-[0.78]">
            <div className="mb-6">
              <h2 className="max-w-xl text-3xl font-semibold tracking-tight text-zinc-950">
                From request to published.
                <br />
                All your school marketing,{" "}
                <span className="text-violet-600">streamlined.</span>
              </h2>
            </div>

            <div className="relative">
              <svg
                aria-hidden="true"
                className="absolute -left-10 top-6 h-[310px] w-[92px] overflow-visible text-violet-600/70"
                viewBox="0 0 92 310"
                fill="none"
              >
                <path
                  d="M43 0 C10 44 16 76 51 96 C83 114 80 148 47 168 C11 190 13 226 49 247 C67 258 70 278 56 310"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeDasharray="4 7"
                  strokeLinecap="round"
                />
              </svg>
              <div className="space-y-4">
                {workflowVisuals.map((visual, index) => {
                  const step = workflowSteps[index] ?? fallbackWorkflowSteps[index];
                  const Icon = visual.icon;
                  const tone = toneClass[visual.tone];
                  return (
                    <div key={step.title} className={`relative flex items-center ${visual.offset}`}>
                      <span
                        className={`absolute -left-[58px] flex h-10 w-10 items-center justify-center rounded-full ${tone.rail} text-white shadow-lg shadow-violet-500/20`}
                      >
                        <Icon className="h-5 w-5" aria-hidden="true" />
                      </span>
                      <div className="flex w-full items-center gap-4 rounded-2xl border border-white/80 bg-white/90 p-3.5 shadow-[0_20px_55px_rgba(15,23,42,0.10),inset_0_1px_0_rgba(255,255,255,0.9)] backdrop-blur-xl">
                        <span
                          className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ${tone.icon}`}
                        >
                          <Icon className="h-7 w-7" aria-hidden="true" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-base font-semibold text-zinc-950">
                            {step.title}
                          </p>
                          <p className="mt-1 truncate text-sm text-zinc-600">
                            {step.school}
                          </p>
                        </div>
                        <div className="text-right">
                          <span
                            className={`inline-flex rounded-lg px-3 py-1 text-xs font-semibold ${tone.chip}`}
                          >
                            {step.status}
                          </span>
                          <p className="mt-2 text-sm text-zinc-500">
                            {step.time}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="-ml-28 mt-16 grid grid-cols-4 gap-0 bg-transparent pt-4 xl:-ml-32">
              {productHighlights.map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.title}
                    className="min-w-0 border-r border-zinc-300/35 px-5 first:pl-0 last:border-r-0 last:pr-0"
                  >
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/92 text-violet-700 shadow-[0_12px_26px_rgba(124,58,237,0.14),inset_0_1px_0_rgba(255,255,255,0.9)]">
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <p className="mt-3 text-sm font-semibold leading-snug text-violet-700">
                      {item.title}
                    </p>
                    <p className="mt-1.5 text-xs leading-5 text-zinc-600">
                      {item.body}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
