#!/usr/bin/env node

import * as AWS from 'aws-sdk';
import * as chalk from 'chalk';
import { spawn } from 'child_process';
import * as program from 'commander';

import config, { IConfig } from './config';
import * as deployer from './ecs-deploy';
import { promisify } from './promisify';

require('pkginfo')(module, 'version');
program
  .version(module.exports.version)
  .usage('[options]')
  .description(`Build, tag and upload a Docker image and then restart an ECS service.
  Optionally specify a sub-command.`)
  .option('-s, --sub-command <which>',
  'login|build|restart-service|taskDefinition',
  /^(login|build|restart\-service|restart\-terraform|taskDefinition)$/)
  .option('--no-login', 'Skip login')
  .parse(process.argv);

const opts = program.opts();

switch (opts.subCommand) {
  case 'login':
    ecrLogin(config)
      .then(dockerLogin)
      .then(console.log, fail());
    break;
  case 'build':
    ecrLogin(config)
      .then(r => build(config, tryPrependRepo(config.IMAGE, r.endpoint)))
      .then(console.log, fail());
    break;
  case 'restart-service':
    restartService(config)
      .catch(fail());
    break;
  case 'restart-terraform':
    terraformRestart(config)
      .catch(fail());
    break;
  case 'taskDefinition':
    deployer.getTaskDefinition(config)
      .then(current => deployer.registerTaskDefinition(config, current))
      .then(console.log, fail());
    break;
  default:
    if (!opts.subCommand) {
      start(config, opts.login)
        .catch(fail());
    } else {
      console.error('Invalid syntax');
    }
    break;
}

function fail(msg?: string) {
  if (msg) {
    console.log(msg);
  }
  return (err) => {
    console.log(chalk.bold.red('\nFailed with error:\n'));
    console.log(err);
    process.exit(1);
  };
}

export async function restartService(config: IConfig) {

  const { current, previous } = await deployer.restart(config);
  await deployer.syncRevision(config, current);

  return {
    current,
    previous,
  };
}

export async function terraformRestart(config: IConfig) {

  console.log(chalk.bold.green('\nRestarting the service to use the latest taskDefinition in S3\n'));

  const {container, taskDefinition} = await deployer.terraformRestart(config);

  console.log('Updated service %s to revision %s', config.SERVICE, taskDefinition.revision);

  console.log(chalk.bold.green('\nSyncing revision and image tag to S3\n'));
  await deployer.syncRevision(config, taskDefinition);
  await deployer.syncImageTag(config, container);

  return {
    container,
    taskDefinition,
  };
}

async function runDocker(...args: string[]): Promise<boolean> {
  let stdio: any = 'inherit';
  let silent = false;
  if (args[0] === 'silent') {
    args.shift();
    silent = true;
  }
  return new Promise<boolean>((resolve, reject) => {
    const docker = spawn('docker', args, { stdio });
    if (!silent) {
      console.log(['docker'].concat(args).join(' '));
    }
    docker.on('close', (code) => {
      if (code !== 0) {
        console.log(`docker process exited with code ${code}`);
        reject(code);
        return;
      }
      resolve(true);
    });

    docker.on('error', (err) => {
      console.log(`docker process exited with code ${err}`);
      reject(err);
    });
  });

}

interface EcrLogin {
  user: string;
  password: string;
  endpoint: string;
}

export async function ecrLogin(config: IConfig): Promise<EcrLogin> {
  const ecr = new (<any>AWS).ECR({ region: config.REGION });
  const getToken = promisify<any>(ecr.getAuthorizationToken, ecr);
  const response = await getToken();
  const o = response.authorizationData[0];
  const login = Buffer.from(o.authorizationToken, 'base64').toString('utf8');
  const parts = login.split(':');
  return {
    user: parts[0],
    password: parts[1],
    endpoint: o.proxyEndpoint,
  };
}

function dockerLogin({user, password, endpoint}) {
  return runDocker(
    'silent',
    'login',
    '-u', user,
    '-p', password,
    '-e', 'none',
    endpoint
  );
}

function build(config: IConfig, image?) {
  return runDocker(
    'build',
    '-f', config.DOCKERFILE!,
    '-t', `${image || config.IMAGE}:${config.IMAGE_TAG}`,
    '.'
  );
}

function push(config: IConfig, image?) {
  return runDocker(
    'push',
    `${image || config.IMAGE}:${config.IMAGE_TAG}`
  );
}

async function login(config: IConfig) {
  console.log(chalk.bold.green('Logging in to ECR\n'));
  // get ECR login
  const credentials = await ecrLogin(config);

  // login with Docker
  await dockerLogin(credentials);

  return tryPrependRepo(config.IMAGE, credentials.endpoint);
}



function getRevision(taskDefinitionArn: string) {
  const parts = taskDefinitionArn.split(':');
  return parseInt(parts[parts.length - 1], 10);
}


function isECR(image: string) {
  return image.indexOf('/') === -1; // we assume Docker Hub otherwise
}

function tryPrependRepo(image, endpoint) {
  let newImage = image;
  if (isECR(image)) {
    const parts = endpoint.split('//');
    if (parts.length === 2) {
      newImage = parts[1] + '/' + image;
    }
  }
  return newImage;
}

export async function start(config: IConfig, loginFlag = true) {

  let image = config.IMAGE;
  if (loginFlag && isECR(config.IMAGE!)) {
    image = await login(config);
  }
  console.log(chalk.bold.green('\nBuilding the Docker image\n'));
  // build
  await build(config, image);

  console.log(chalk.bold.green('\nPushing to repository\n'));
  await push(config, image);

  // deploy service
  console.log(chalk.bold.green('\nRestarting ECS service %s\n'), config.SERVICE);
  const configCopy = Object.assign({}, config, { IMAGE: image });
  const {container, taskDefinition} = await deployer.deploy(configCopy);

  console.log('Updated service %s to use image %s', config.SERVICE, container.image);

  if (config.BUCKET && config.KEY) {
    console.log(chalk.bold.green('\nUpdating revision and image tag to S3\n'));
    await deployer.syncRevision(configCopy, taskDefinition);
    await deployer.syncImageTag(configCopy, container);
  }

  console.log(chalk.bold.green('\nDONE'));


}
