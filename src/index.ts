#!/usr/bin/env node

import * as AWS from 'aws-sdk';
import * as chalk from 'chalk';
import { spawn } from 'child_process';
import * as program from 'commander';

import config, { IConfig } from './config';
import * as deployer from './ecs-deploy';
import { promisify } from './promisify';


program
  .version('0.0.1')
  .usage('[options]')
  .description(`Build, tag and upload a Docker image and then restart an ECS service.
  Optionally specify a sub-command.`)
  .option('-s, --sub-command <which>',
    'login|build|restart-service|taskDefinition',
    /^(login|build|restart\-service|taskDefinition)$/)
  .option('--no-login', 'Skip login')
  .parse(process.argv);

const opts = program.opts();
switch (opts.subCommand) {
  case 'login':
    ecrLogin(config)
      .then(dockerLogin)
      .then(console.log, console.log);
    break;
  case 'build':
    ecrLogin(config)
      .then(r => build(config, tryPrependRepo(config.IMAGE, r.endpoint)))
      .then(console.log, console.log);
    break;
  case 'restart-service':
    deployer.deploy(config, false)
      .then(response => {
        return s3(config, response.service.taskDefinition);
      })
      .then(console.log, console.log);
    break;
  case 'taskDefinition':
    deployer.deploy(config, true)
      .then(console.log, console.log);
    break;
  default:
    if (!opts.subCommand) {
      console.log(opts);
      start(config, opts.login)
        .catch(console.log);
    } else {
      console.error('Invalid syntax');
    }
    break;
}

// const repository = opts.repository as string;
// const tag = opts.tag as string;

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

async function ecrLogin(config: IConfig): Promise<EcrLogin> {
  const ecr = new (<any> AWS).ECR({ region: config.REGION });
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
    '-e', 'none',
    '-u', user,
    '-p', password,
    endpoint
  );
}

function build(config: IConfig, image?) {
  return runDocker(
    'build',
    '-f', config.DOCKERFILE,
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

async function s3(config: IConfig, taskDefinitionArn: string) {
  const s3 = new AWS.S3({ region: config.REGION });
  const revision = getRevision(taskDefinitionArn);
  const image = getImage(taskDefinitionArn);
  const put = promisify(s3.putObject, s3);
  const tagKey = config.KEY + '_tag';
  const revisionKey = config.KEY + '_revision';
  await put({
    Bucket: config.BUCKET,
    Key: tagKey,
    ContentType: 'text/plain',
    Body: config.IMAGE_TAG,
  });
  console.log(`s3://${config.BUCKET}/${tagKey} => ${config.IMAGE_TAG}` );
  await put({
    Bucket: config.BUCKET,
    Key: revisionKey,
    ContentType: 'text/plain',
    Body: String(revision),
  });
  console.log(`s3://${config.BUCKET}/${revisionKey} => ${revision}` );

}

function getRevision(taskDefinitionArn: string) {
  const parts = taskDefinitionArn.split(':');
  return parseInt(parts[parts.length - 1], 10);
}

function getImage(imageWithTag: string) {
  const parts = imageWithTag.split(':');
  parts.pop();
  return parts.join(':');
}

function getTag(imageWithTag: string) {
  const parts = imageWithTag.split(':');
  return parts[parts.length - 1];
}


function tryPrependRepo(image, endpoint) {
  let newImage = image;
  if (image.indexOf('/') === -1) {
    const parts = endpoint.split('//');
    if (parts.length === 2) {
      newImage = parts[1] + '/' + image;
    }
  }
  return newImage;
}

async function start(config: IConfig, login = true) {

  let image = config.IMAGE;
  if (login) {
    console.log(chalk.bold.green('Logging in to ECR\n'));
    // get ECR login
    const credentials = await ecrLogin(config);
    image = tryPrependRepo(config.IMAGE, credentials.endpoint);

    // login with Docker
    await dockerLogin(credentials);
  }
  console.log(chalk.bold.green('\nBuilding the Docker image\n'));
  // build
  await build(config, image);
  // console.log(chalk.bold.green('Built succesfully'));

  console.log(chalk.bold.green('\nPushing to ECR\n'));
  await push(config, image);
  // console.log(chalk.bold.green('Pushed succesfully'));

  // deploy service
  console.log(chalk.bold.green('\nRestarting ECS service %s\n'), config.SERVICE);
  const configCopy = Object.assign({}, config, {IMAGE: image});
  const response = await deployer.deploy(configCopy);
  // console.log(chalk.bold.green('%s restarted and updated to revision %s succesfully'), config.SERVICE, revision);


  console.log(chalk.bold.green('\nUpdating revision and image tag to S3\n'));
  await s3(config, response.service.taskDefinition);

  console.log(chalk.bold.green('\nDONE'));


}
