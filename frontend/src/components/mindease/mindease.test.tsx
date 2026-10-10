import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";

import { ThemeToggle } from "./ThemeToggle";
import { CopilotStar } from "./CopilotStar";
import { IntroSplash, SPLASH_KEY } from "./IntroSplash";
import { LiveBackground } from "./LiveBackground";
import { DashboardSidebar } from "../dashboard/DashboardSidebar";
import { StatCard } from "../dashboard/StatCard";
import { smoothPath } from "@/lib/flow";

beforeEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.classList.remove("dark");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ThemeToggle", () => {
  it("defaults to dark and sets the dark class", () => {
    render(<ThemeToggle />);
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
  });

  it("shows Light and Dark labels", () => {
    render(<ThemeToggle />);
    expect(screen.getByText("Light")).toBeTruthy();
    expect(screen.getByText("Dark")).toBeTruthy();
  });

  it("switches to light, persists, then back to dark", () => {
    render(<ThemeToggle />);
    const sw = screen.getByRole("switch");

    fireEvent.click(sw);
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem("mindease-theme")).toBe("light");

    fireEvent.click(sw);
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem("mindease-theme")).toBe("dark");
  });

  it("restores a saved light theme", () => {
    localStorage.setItem("mindease-theme", "light");
    render(<ThemeToggle />);
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });
});

describe("CopilotStar", () => {
  it("opens and closes via onClick with the right label", () => {
    const onClick = vi.fn();
    const { rerender } = render(<CopilotStar open={false} onClick={onClick} />);
    fireEvent.click(screen.getByRole("button", { name: "Open co-pilot" }));
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(<CopilotStar open onClick={onClick} />);
    expect(screen.getByRole("button", { name: "Close co-pilot" })).toBeTruthy();
  });

  it("shows the attention dot only when closed", () => {
    const { rerender } = render(<CopilotStar open={false} attention onClick={() => {}} />);
    expect(screen.getByLabelText("Needs attention")).toBeTruthy();
    rerender(<CopilotStar open attention onClick={() => {}} />);
    expect(screen.queryByLabelText("Needs attention")).toBeNull();
  });
});

describe("IntroSplash", () => {
  it("renders nothing when the login flag is absent", () => {
    render(<IntroSplash />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("plays once after login, consumes the flag, then disappears", () => {
    vi.useFakeTimers();
    sessionStorage.setItem(SPLASH_KEY, "1");
    render(<IntroSplash />);

    expect(screen.getByRole("status", { name: "MindEase" })).toBeTruthy();
    expect(sessionStorage.getItem(SPLASH_KEY)).toBeNull();

    act(() => {
      vi.advanceTimersByTime(3100); // intro finishes and starts fading out
    });
    act(() => {
      vi.advanceTimersByTime(800); // fade-out completes and it unmounts
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("can be skipped by clicking", () => {
    vi.useFakeTimers();
    sessionStorage.setItem(SPLASH_KEY, "1");
    render(<IntroSplash />);

    fireEvent.click(screen.getByRole("status"));
    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("LiveBackground", () => {
  it("renders the glows, aurora and star canvas", () => {
    const { container } = render(<LiveBackground />);
    expect(container.querySelectorAll(".me-live__blob").length).toBe(3);
    expect(container.querySelector(".me-live__aurora")).toBeTruthy();
    expect(container.querySelector("canvas")).toBeTruthy();
  });
});

describe("flow helpers and cards", () => {
  it("smoothPath builds a curve through the points", () => {
    expect(smoothPath([])).toBe("");
    const d = smoothPath([[0, 0], [10, 10], [20, 0]]);
    expect(d.startsWith("M0.0,0.0")).toBe(true);
    expect(d.split("C").length - 1).toBe(2);
  });

  it("StatCard draws the flowing sparkline", () => {
    const { container } = render(
      <StatCard
        label="Focus Score"
        value="62%"
        caption="5 sessions recorded"
        direction="up"
        icon={() => <span />}
        tone="blue"
        spark={[0.2, 0.4, 0.3, 0.6]}
      />,
    );
    expect(screen.getByText("62%")).toBeTruthy();
    expect(container.querySelectorAll("svg path").length).toBeGreaterThanOrEqual(3);
  });
});

describe("DashboardSidebar branding", () => {
  it("shows MindEase, never the old name, and navigates", () => {
    const onNavigate = vi.fn();
    render(
      <DashboardSidebar
        name="Divya Desai"
        email="divya@example.com"
        cli={0.51}
        cliCategory="Moderate"
        activeSection="home"
        onNavigate={onNavigate}
        onLogout={() => {}}
      />,
    );
    expect(screen.getByText("MindEase")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/burnout\s*copilot/i);
    expect(screen.getByText("51%")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Digital Twin/ }));
    expect(onNavigate).toHaveBeenCalledWith("Digital Twin");
  });
});