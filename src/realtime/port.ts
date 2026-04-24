export interface RealtimePublisher {
  publish(channel: string, event: unknown): Promise<void>;
}
