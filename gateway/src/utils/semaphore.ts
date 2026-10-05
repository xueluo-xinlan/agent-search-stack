/** 简单信号量：限制并发数，超出排队等待。 */
export class Semaphore {
  private queue: Array<() => void> = [];
  private active = 0;

  constructor(private max: number) {}

  async acquire(): Promise<() => void> {
    if (this.active < this.max) {
      this.active++;
      return this.release;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active++;
    return this.release;
  }

  private release = (): void => {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  };
}
