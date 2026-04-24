export async function sendPush(body: unknown): Promise<void> {
  const response = await fetch("/api/sync/push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Push failed: HTTP ${response.status}: ${errorText}`);
  }
}
