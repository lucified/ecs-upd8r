import * as deployer from './ecs-deploy';
import * as path from 'path';

const configDefaults = {
  REGION: '',
  CLUSTER: '',
  SERVICE: '',
  CONTAINER: '',
  IMAGE: '',
  IMAGE_TAG: '',
  BUCKET: '',
  KEY: '',
  DOCKERFILE: 'Dockerfile',
};

export type IConfig = typeof configDefaults;

let config = Object.assign({}, configDefaults);
const configFilePath = path.join(process.cwd(), 'ecs-upd8r');

const git = require('git-rev-sync');

try {
  const fc = require(configFilePath);
  config = deployer.overrideValues(fc, config);
} catch (err) {
  console.log('No config-file found');
}

if (config.IMAGE_TAG === '') {
  let sha1: string = process.env.SHA1 ? process.env.SHA1 : process.env.CIRCLE_SHA1;

  if (!sha1) {
    console.log(__dirname);
    sha1 = git.long(process.cwd());
  }

  if (sha1) {
    sha1 = sha1.substr(0, 6);
    config.IMAGE_TAG = sha1;
    const build = process.env.BUILD_NUM ? process.env.BUILD_NUM : process.env.CIRCLE_BUILD_NUM;
    if (build) {
      config.IMAGE_TAG =  + `${build}_` + config.IMAGE_TAG;
    }
  }
}

export default deployer.overrideValues(process.env, config);
