import path from 'path';
import express, { Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { errorHandler } from './middleware/errorHandler';
import { getRouteEntries } from './utils/routesRegistry';
import { adminAuthMiddleware } from './middleware/auth';
import './api';
import { seedData } from './core';
import { logger } from './utils/logger';

export const initServer = async (app: Express) => {
  await seedData();

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ['\'self\''],
        scriptSrc: ['\'self\'', '\'unsafe-inline\''],
        scriptSrcAttr: ['\'unsafe-inline\''],
        styleSrc: ['\'self\'', '\'unsafe-inline\'', 'https://fonts.googleapis.com'],
        imgSrc: ['\'self\'', 'data:', 'https:'],
        connectSrc: ['\'self\''],
        fontSrc: ['\'self\'', 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'],
        objectSrc: ['\'none\''],
        mediaSrc: ['\'self\''],
        frameSrc: ['\'none\''],
      },
    },
  }));
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use(cookieParser());
  app.use((_, res, next) => {
    res.header('Cross-Origin-Resource-Policy', 'cross-origin');
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', '*');
    res.header('Access-Control-Allow-Headers', '*');
    next();
  });

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'static/web-widget'));
  app.use('/', express.static(path.join(__dirname, 'static')));

  getRouteEntries().forEach(([path, routeInfo]) => {
    const handlers = [routeInfo.handler];
    if (routeInfo.options.protected) {
      handlers.unshift(adminAuthMiddleware);
    }
    app[routeInfo.method === '*' ? 'use' : routeInfo.method](path, ...handlers);
  });

  app.use((_, res) => {
    res.sendFile(path.join(__dirname, './static/index.html'));
  });
  app.use(errorHandler);
};
