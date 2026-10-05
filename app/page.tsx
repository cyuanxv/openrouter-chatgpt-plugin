const groups = [
  {
    title: "Account",
    items: ["Balance", "Today / Yesterday / 7D / 30D spend"]
  },
  {
    title: "Analytics",
    items: ["Usage trends", "Cost anomalies", "Cost optimization"]
  },
  {
    title: "Models",
    items: ["Live model comparison", "Provider price evidence"]
  },
  {
    title: "Developer",
    items: ["API key metadata", "Live Analytics schema"]
  }
];

export default function Home() {
  return (
    <main
      style={{
        fontFamily: "ui-sans-serif, system-ui, -apple-system",
        maxWidth: 880,
        margin: "64px auto",
        padding: "0 24px",
        lineHeight: 1.6
      }}
    >
      <p style={{ fontWeight: 700, letterSpacing: "0.08em", color: "#555" }}>
        ROUTERLENS
      </p>
      <h1 style={{ fontSize: 44, lineHeight: 1.1, marginBottom: 16 }}>
        OpenRouter analytics for ChatGPT and Codex
      </h1>
      <p style={{ fontSize: 18, color: "#555", maxWidth: 720 }}>
        Private, read-only OpenRouter account analytics, model comparison and cost
        optimization. The companion plugin also connects to OpenRouter&apos;s official
        MCP server for model discovery, providers, benchmarks, generations and docs.
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 16,
          marginTop: 36
        }}
      >
        {groups.map((group) => (
          <section
            key={group.title}
            style={{
              border: "1px solid #ddd",
              borderRadius: 16,
              padding: 20
            }}
          >
            <h2 style={{ fontSize: 18, marginTop: 0 }}>{group.title}</h2>
            <ul style={{ paddingLeft: 20, marginBottom: 0 }}>
              {group.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <p style={{ marginTop: 36, color: "#666" }}>
        MCP endpoint: <code>/api/mcp</code> · Health: <code>/api/health</code>
      </p>
    </main>
  );
}
