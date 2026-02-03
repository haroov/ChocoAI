import { IRouterHandler, RequestHandler } from 'express';
import { RouteParameters } from 'express-serve-static-core';

type RouteOptions = {
  protected?: boolean;
}

type RouteInfo = {
  method: 'get' | 'post' | 'put' | 'delete' | 'patch' | 'head' | 'options' | 'trace' | 'connect' | '*';
  handler: RequestHandler;
  options: RouteOptions;
}

const routesRegistry = new Map<string, RouteInfo[]>();

export const registerRoute = <
  TMethod extends RouteInfo['method'],
  TRoute extends string,
  TParams = RouteParameters<TRoute>,
>(method: TMethod, path: TRoute, handler: RequestHandler<TParams>, options: RouteOptions = {}) => {
  const existingRoutes = routesRegistry.get(path) || [];
  existingRoutes.push({
    method: method,
    handler: handler as never,
    options,
  });
  routesRegistry.set(path, existingRoutes);
};

export const getRouteEntries = () => {
  const res: [string, RouteInfo][] = [];
  for (const [path, routes] of routesRegistry) {
    for (const route of routes) {
      res.push([path, route]);
    }
  }
  return res;
};
