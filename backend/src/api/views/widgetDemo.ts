import { RequestHandler } from 'express';
import { config } from '../../core';
import { registerRoute } from '../../utils/routesRegistry';

const handler: RequestHandler = (req, res) => {
  res.render('widget-demo', {
    rootUrl: config.rootUrl,
  });
};

registerRoute('get', '/web-widget/widget-demo.html', handler);
registerRoute('get', '/web-widget/demo', handler);
