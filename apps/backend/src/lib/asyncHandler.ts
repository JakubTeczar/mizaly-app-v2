import { NextFunction, Request, Response } from "express";

type AsyncRouteHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<unknown>;

// Wraps an async Express handler so thrown errors / rejected promises are
// forwarded to next(err) and handled by the central error middleware,
// instead of crashing the process or hanging the request.
export function asyncHandler(handler: AsyncRouteHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, next).catch(next);
  };
}
