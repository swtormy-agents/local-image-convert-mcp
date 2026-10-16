/** An error whose message is safe and useful to show to the model/user. */
export class UserError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "UserError";
  }
}
