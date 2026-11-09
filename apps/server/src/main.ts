import { Logger } from '@nestjs/common';
import { createApp } from './app.factory.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = await createApp(config);
await app.listen(config.port, config.host);
new Logger('flagken').log(`listening on http://${config.host}:${config.port}`);
