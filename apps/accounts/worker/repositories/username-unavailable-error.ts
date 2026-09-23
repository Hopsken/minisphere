export class UsernameUnavailableError extends Error {
  constructor() {
    super("Username is not available");
    this.name = "UsernameUnavailableError";
  }
}
