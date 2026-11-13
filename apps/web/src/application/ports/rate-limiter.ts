export interface RateLimiter {
  consume(key: string, limit: number, windowSeconds: number): Promise<boolean>;
}
