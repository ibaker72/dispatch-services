export class AppError extends Error {
  constructor(
    message: string,
    readonly code: "not_found" | "forbidden" | "validation" | "conflict" | "unauthenticated" | "configuration" = "validation",
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found.") {
    super(message, "not_found");
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have access to this.") {
    super(message, "forbidden");
  }
}
