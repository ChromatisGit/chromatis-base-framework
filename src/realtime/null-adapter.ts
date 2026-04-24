import type { RealtimePublisher } from "./port.js";

export const nullRealtimeAdapter: RealtimePublisher = {
  async publish(_channel, _event) {},
};
