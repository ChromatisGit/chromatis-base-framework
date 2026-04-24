import type { ExecuteOperationResult } from "@platform/operations/types.js";

export async function sendTranscribeAudio(formData: FormData): Promise<ExecuteOperationResult> {
  const response = await fetch("/api/operations/execute", { method: "POST", body: formData });
  if (!response.ok) {
    throw new Error(`Transcribe request failed: ${response.status}`);
  }
  return response.json() as Promise<ExecuteOperationResult>;
}

export async function sendProcessPrompt(body: object): Promise<ExecuteOperationResult> {
  const response = await fetch("/api/operations/execute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Process prompt request failed: ${response.status}`);
  }
  return response.json() as Promise<ExecuteOperationResult>;
}

export async function transcribeAudioNow(blob: Blob, mimeType: string): Promise<string> {
  const formData = new FormData();
  formData.append("audio", blob, "audio");
  formData.append("mime_type", mimeType);

  const response = await fetch("/api/operations/execute", { method: "POST", body: formData });
  if (!response.ok) {
    throw new Error(`Transcribe request failed: ${response.status}`);
  }

  const result = await response.json() as ExecuteOperationResult;
  if (result.kind !== "transcribe_audio") throw new Error("Unexpected transcription response");
  if (result.status !== "done" || !result.transcript_text) {
    throw new Error(result.error ?? "Transcription failed");
  }
  return result.transcript_text;
}
