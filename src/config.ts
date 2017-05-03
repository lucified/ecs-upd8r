import * as path from 'path';
import * as deployer from './ecs-deploy';

const configDefaults: IConfig = {
  REGION: 'eu-west-1',
  CLUSTER: 'default',
  DOCKERFILE: 'Dockerfile',
  SERVICE: '',
  CONTAINER: '',
  IMAGE: '',
  IMAGE_TAG: '',
  BUCKET: '',
  KEY: '',
  TASKDEFINITION_KEY: '',
};

export interface IConfig {
  CLUSTER?: string;
  SERVICE?: string;
  CONTAINER?: string;
  REGION?: string;
  IMAGE?: string;
  IMAGE_TAG?: string;
  BUCKET?: string;
  KEY?: string;
  TASKDEFINITION_KEY?: string;
  DOCKERFILE?: string;
}

let config = Object.assign({}, configDefaults);
const configFilePath = path.join(process.cwd(), 'ecs-updater');

const git = require('git-rev-sync');

try {
  const fc = require(configFilePath);
  config = deployer.overrideValues(fc, config);
} catch (err) {
  if (err.name === 'SyntaxError') {
    throw err;
  }
  console.log('[INFO] No config-file found in %s, using only env variables', configFilePath);
}

if (!config.IMAGE_TAG) {
  let sha1: string = process.env.SHA1 ? process.env.SHA1 : process.env.CIRCLE_SHA1;

  if (!sha1) {
    sha1 = git.long(process.cwd());
  }

  if (sha1) {
    sha1 = sha1.substr(0, 6);
    config.IMAGE_TAG = sha1;
    const build = process.env.BUILD_NUM ? process.env.BUILD_NUM : process.env.CIRCLE_BUILD_NUM;
    if (build) {
      config.IMAGE_TAG = `${build}_${config.IMAGE_TAG}`;
    }
  }
}

export default deployer.overrideValues(process.env, config) as IConfig;
