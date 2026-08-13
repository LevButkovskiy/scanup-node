export interface PingPayloadV1 {
  host: string;
}

export interface PingResult {
  host: string;
  alive: boolean;
  min?: number;
  avg?: number;
  max?: number;
  packetLoss?: number;
  error?: string;
  queryTime: number;
}
