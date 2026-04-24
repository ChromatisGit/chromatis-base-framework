import type { RealtimePublisher } from "./port.js";
import { nullRealtimeAdapter } from "./null-adapter.js";

let publisher: RealtimePublisher = nullRealtimeAdapter;

export function getRealtimePublisher(): RealtimePublisher {
  return publisher;
}

export function setRealtimePublisher(p: RealtimePublisher): void {
  publisher = p;
}
