import { BarChart3, FileText, Globe, Home, Lightbulb, LogOut, Sparkles, Gauge } from "lucide-react";

import { MindEaseMark } from "@/components/mindease/MindEaseLogo";

interface Props {
  name: string;
  email: string;
  /** Accepted so existing callers keep compiling. The sidebar no longer shows sync status. */
  lastSynced?: string | undefined;
  cli: number;
  cliCategory: string;
  activeSection: string;
  onNavigate: (label: string) => void;
  onLogout: () => void;
}

const NAV = [
  { label: "Home", icon: Home },
  { label: "Digital Twin", icon: Globe },
  { label: "Recommendations", icon: Lightbulb },
  { label: "Analytics", icon: BarChart3 },
  { label: "AI Insights", icon: Sparkles },
  { label: "Reports", icon: FileText },
] as const;

function riskLabel(category: string): string {
  const c = category.toLowerCase();
  if (c === "high") return "Elevated risk";
  if (c === "medium" || c === "moderate") return "Moderate risk";
  if (c === "low") return "Low risk";
  return category ? `${category} risk` : "No data yet";
}

export function DashboardSidebar({ name, email, cli, cliCategory, activeSection, onNavigate, onLogout }: Props) {
  const pct = Math.round(Math.max(0, Math.min(Number.isFinite(cli) ? cli : 0, 1)) * 100);
  const initial = (name || email || "?").trim().charAt(0).toUpperCase();

  return (
    <aside
      aria-label="Sidebar"
      className="clay-card flex w-full shrink-0 flex-col gap-5 p-4 md:sticky md:top-6 md:h-[calc(100vh-3rem)] md:w-64"
    >
      <div className="flex items-center gap-3 px-1">
        <MindEaseMark className="size-11" />
        <div className="leading-tight">
          <p className="font-display text-lg font-extrabold">MindEase</p>
          <p className="text-xs text-muted-foreground">Co-pilot</p>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-muted/40 p-4">
        <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wide text-muted-foreground">
          <span className="flex items-center gap-2">
            <Gauge className="size-4 text-clay-purple" aria-hidden="true" />
            CLI score
          </span>
          <span className="text-sm text-foreground">{pct}%</span>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={`CLI score ${pct} percent`}>
          <div className="h-full rounded-full bg-clay-purple transition-all duration-700" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">{riskLabel(cliCategory)}</p>
      </div>

      <nav aria-label="Main" className="flex flex-col gap-1">
        {NAV.map(({ label, icon: Icon }) => {
          const id = label.toLowerCase().replaceAll(" ", "-");
          const active = activeSection === id;
          return (
            <button
              key={label}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => onNavigate(label)}
              className={`flex items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm transition-colors duration-300 ${
                active
                  ? "bg-clay-purple/15 font-bold text-clay-purple"
                  : "font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Icon className="size-[1.1rem]" aria-hidden="true" />
              {label}
            </button>
          );
        })}
      </nav>

      <div className="mt-auto flex items-center gap-3 rounded-2xl border border-border bg-muted/40 p-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-clay-purple text-sm font-bold text-card">
          {initial}
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-sm font-bold">{name || "Signed in"}</p>
          <p className="truncate text-xs text-muted-foreground">{email}</p>
        </div>
        <button
          type="button"
          onClick={onLogout}
          aria-label="Log out"
          title="Log out"
          className="grid size-8 shrink-0 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <LogOut className="size-4" />
        </button>
      </div>
    </aside>
  );
}
