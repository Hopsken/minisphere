export class PdsResponseError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "PdsResponseError";
    this.status = status;
  }
}
