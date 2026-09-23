import { Logger } from '@nestjs/common';

import { TextLogger } from '../src/common/logging/app-logger';
import { setTestEnvDefaults } from './test-env';

setTestEnvDefaults();
// Services created outside a Nest application log through the static Nest
// logger; print their events in the local development format.
Logger.overrideLogger(new TextLogger());
