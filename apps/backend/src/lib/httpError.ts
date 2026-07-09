// Simple typed error carrying an HTTP status code, so route handlers can just
// `throw new HttpError(404, "Nie znaleziono.")` and let the error middleware
// in index.ts turn it into the right response.
export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "HttpError";
  }
}
