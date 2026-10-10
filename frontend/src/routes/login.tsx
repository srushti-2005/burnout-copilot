import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Eye, EyeOff, KeyRound, Lock, Mail, Sparkles, Cake } from "lucide-react";
import { toast } from "sonner";

import { loginUser, resetPassword, signupUser } from "@/lib/dashboard.functions";
import type { AuthResult } from "@/lib/dashboard.types";
import { MindEaseMark } from "@/components/mindease/MindEaseLogo";
import { ThemeToggle } from "@/components/mindease/ThemeToggle";

export const Route = createFileRoute("/login")({
    head: () => ({
    meta: [
      { title: "Sign in — MindEase" },
      {
        name: "description",
        content: "Sign in to MindEase to see your live burnout risk and wellness insights.",
      },
      { property: "og:title", content: "Sign in — MindEase" },
      {
        property: "og:description",
        content: "Sign in to see your live burnout risk and wellness insights.",
      },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [age, setAge] = useState("");
  const [confirm, setConfirm] = useState("");
  const [name, setName] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  const doLogin = useServerFn(loginUser);
  const doSignup = useServerFn(signupUser);
  const doReset = useServerFn(resetPassword);

  const finish = (r: AuthResult) => {
    if (r.success && r.uid && r.access_token) {
      localStorage.setItem("bc_uid", r.uid);
            localStorage.setItem("bc_token", r.access_token);
      try {
        sessionStorage.setItem("me_splash", "1"); // plays the MindEase intro once after login
      } catch {
        /* ignore */
      }
      void navigate({ to: "/" });
      return;
    }
    if (r.success && r.uid && tab === "signup") {
      // Account exists but Supabase issued no session (e.g. email confirmation required)
      toast.success("Account created. Please log in to continue.");
      setTab("login");
      setPassword("");
      setConfirm("");
      return;
    }
    if (r.success) {
      toast.error("Signed in, but no session token was returned. Please try again.");
      return;
    }
    toast.error(r.error || "Something went wrong");
  };

  const onSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!email || !password) {
      toast.error("Enter email and password.");
      return;
    }
    setBusy(true);
    try {
      if (tab === "login") {
        finish(await doLogin({ data: { email: email.trim(), password } }));
      } else {
        if (!name) {
          toast.error("Fill in all fields.");
          return;
        }
        const ageNum = Number(age);
        if (!age || !Number.isInteger(ageNum) || ageNum < 13 || ageNum > 100) {
          toast.error("Enter a valid age between 13 and 100.");
          return;
        }
        if (password !== confirm) {
          toast.error("Passwords do not match.");
          return;
        }
        if (password.length < 6) {
          toast.error("Password must be at least 6 characters.");
          return;
        }
        finish(
          await doSignup({
            data: { email: email.trim(), password, name: name.trim(), age: ageNum },
          }),
        );
      }
    } catch {
      toast.error("Could not reach the service.");
    } finally {
      setBusy(false);
    }
  };

  const onForgot = async (): Promise<void> => {
    if (!email) {
      toast.warning("Enter your email first.");
      return;
    }
    const r = await doReset({ data: { email: email.trim() } });
    if (r.success) toast.success("Reset email sent!");
    else toast.error(r.error || "Could not send email.");
  };

  return (
        <div className="flex min-h-screen items-center justify-center p-6">
      <div className="fixed right-6 top-6 z-20">
        <ThemeToggle />
      </div>
      <div className="clay-card me-page-enter w-full max-w-2xl px-10 py-12">
        <div className="text-center">
          <MindEaseMark className="mx-auto size-16" />
          <h1 className="font-display mt-4 text-5xl font-semibold">MindEase</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            AI-powered wellness insights • Live &amp; continuous
          </p>
        </div>

        <div className="mt-8 flex items-center justify-center gap-8">
          <button
            type="button"
            onClick={() => setTab("login")}
            className={`flex items-center gap-2 border-b-2 pb-2 text-[0.95rem] font-bold transition-colors ${
              tab === "login"
                ? "border-clay-purple text-clay-purple"
                : "border-transparent text-muted-foreground"
            }`}
          >
            <KeyRound className="size-4" />
            Login
          </button>
          <button
            type="button"
            onClick={() => setTab("signup")}
            className={`flex items-center gap-2 border-b-2 pb-2 text-[0.95rem] font-bold transition-colors ${
              tab === "signup"
                ? "border-clay-purple text-clay-purple"
                : "border-transparent text-muted-foreground"
            }`}
          >
            <Sparkles className="size-4" />
            Sign Up
          </button>
        </div>

        <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-5">
          {tab === "signup" && (
            <label className="block">
              <span className="text-sm font-bold">Full name</span>
              <div className="mt-2 flex items-center gap-3 rounded-full border border-border px-5 py-3.5">
                <Sparkles className="size-4 text-muted-foreground" />
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Anika Banerjee"
                  className="w-full bg-transparent outline-none placeholder:text-muted-foreground"
                />
              </div>
            </label>
          )}

          {tab === "signup" && (
            <label className="block">
              <span className="text-sm font-bold">Age</span>
              <div className="mt-2 flex items-center gap-3 rounded-full border border-border px-5 py-3.5">
                <Cake className="size-4 text-muted-foreground" />
                <input
                  type="number"
                  min={13}
                  max={100}
                  value={age}
                  onChange={(e) => setAge(e.target.value)}
                  placeholder="25"
                  className="w-full bg-transparent outline-none placeholder:text-muted-foreground"
                />
              </div>
            </label>
          )}

          <label className="block">
            <span className="text-sm font-bold">Email</span>
            <div className="mt-2 flex items-center gap-3 rounded-full border border-border px-5 py-3.5">
              <Mail className="size-4 text-muted-foreground" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full bg-transparent outline-none placeholder:text-muted-foreground"
              />
            </div>
          </label>

          <label className="block">
            <span className="text-sm font-bold">Password</span>
            <div className="mt-2 flex items-center gap-3 rounded-full border border-border px-5 py-3.5">
              <Lock className="size-4 text-muted-foreground" />
              <input
                type={show ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-transparent outline-none placeholder:text-muted-foreground"
              />
              <button type="button" onClick={() => setShow((s) => !s)} aria-label="Toggle password">
                {show ? (
                  <EyeOff className="size-4 text-muted-foreground" />
                ) : (
                  <Eye className="size-4 text-muted-foreground" />
                )}
              </button>
            </div>
          </label>

          {tab === "signup" && (
            <label className="block">
              <span className="text-sm font-bold">Confirm password</span>
              <div className="mt-2 flex items-center gap-3 rounded-full border border-border px-5 py-3.5">
                <Lock className="size-4 text-muted-foreground" />
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-transparent outline-none placeholder:text-muted-foreground"
                />
              </div>
            </label>
          )}

          <div className="mt-2 flex flex-wrap gap-4">
            <button
              type="submit"
              disabled={busy}
              className="flex-1 rounded-full bg-gradient-to-r from-clay-purple to-clay-pink px-6 py-3.5 text-lg font-bold text-card transition-opacity disabled:opacity-60"
            >
              {tab === "login" ? "Login" : "Create Account"}
            </button>
            {tab === "login" && (
              <button
                type="button"
                onClick={onForgot}
                className="flex-1 rounded-full border border-border px-6 py-3.5 text-lg font-bold transition-colors hover:bg-muted"
              >
                Forgot password?
              </button>
            )}
          </div>
        </form>

        <div className="mt-10 flex items-center justify-center gap-3 text-sm text-muted-foreground">
          <span className="flex items-center gap-2 font-bold text-clay-purple">
            <Sparkles className="size-4" />
            MindEase AI
          </span>
          <span>|</span>
          <span>Always here to help you thrive</span>
        </div>
      </div>
    </div>
  );
}