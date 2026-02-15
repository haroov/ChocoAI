import 'express-serve-static-core';

declare global {
  namespace Express {
    interface Request {
      admin?: {
        sub: string;
        username: string;
        role: string;
      };
      cookies?: Record<string, string>;
    }
  }
}

export { };

