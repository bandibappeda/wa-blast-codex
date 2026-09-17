export interface IdGenerator {
  next(): string;
}

export class UuidGenerator implements IdGenerator {
  next(): string {
    return crypto.randomUUID();
  }
}

export class DeterministicIdGenerator implements IdGenerator {
  private sequence = 0;

  constructor(private readonly prefix = "test") {}

  next(): string {
    this.sequence += 1;
    return `${this.prefix}-${this.sequence.toString().padStart(4, "0")}`;
  }
}
