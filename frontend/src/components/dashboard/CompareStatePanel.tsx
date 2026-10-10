export function CompareStatesPanel() {
  const states = [
    { pct: "17%", label: "Balanced", desc: "Your work pattern is close to your usual routine.", color: "text-risk-low", border: "border-risk-low/30", bg: "bg-risk-low/10" },
    { pct: "52%", label: "Moderate", desc: "Your workload is higher than usual. Consider a short break.", color: "text-clay-yellow", border: "border-clay-yellow/30", bg: "bg-clay-yellow/10" },
    { pct: "68%", label: "Elevated", desc: "Your task switching is significantly higher than usual.", color: "text-clay-coral", border: "border-clay-coral/30", bg: "bg-clay-coral/10" },
    { pct: "86%", label: "High Load", desc: "Your workload is much higher than usual. It's a good time to rest.", color: "text-clay-pink", border: "border-clay-pink/30", bg: "bg-clay-pink/10" },
  ];

  return (
    <div className="clay-card p-6">
      <h2 className="text-xl">Different Wellbeing States</h2>
      <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {states.map((s) => (
          <div key={s.label} className={`flex flex-col items-center rounded-2xl border p-5 text-center ${s.border} ${s.bg}`}>
            <span className={`font-display text-3xl font-extrabold ${s.color}`}>{s.pct}</span>
            <span className="mt-1 font-bold text-foreground">{s.label}</span>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{s.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}