#!/usr/bin/env node

import * as AWS from 'aws-sdk';
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
  .parse(process.argv);

const opts = program.opts();

switch (opts.part) {
  case 'login':
    ecrLogin(config)
      .then(console.log, console.log);
    break;
  case 'build':
    ecrLogin(config)
      .then(console.log, console.log);
    break;
  case 'restart-service':
    deployer.deploy(config)
      .then(console.log, console.log);
    break;
  case 'taskDefinition':
    deployer.deploy(config, true)
      .then(response => {
        const revision = getRevision(response.taskDefinition.taskDefinitionArn);
        return s3(config, revision);
      })
      .then(console.log, console.log);
    break;
  default:
    if (!opts.part) {
      start(config)
        .catch(console.log);
    } else {
      console.error('Invalid syntax');
    }
    break;
}

// const repository = opts.repository as string;
// const tag = opts.tag as string;

async function runDocker(...args: string[]): Promise<boolean> {

  return new Promise<boolean>((resolve, reject) => {
    const docker = spawn('docker', args, {
      stdio: 'inherit',
    });
    console.log(['docker'].concat(args).join(' '));
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

async function s3(config: IConfig, revision: number) {
  const s3 = new AWS.S3({ region: config.REGION });
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

async function start(config: IConfig) {

  // get ECR login
  const { user, password, endpoint } = await ecrLogin(config);

  // login with Docker
  await runDocker(
    'login',
    '-u', user,
    '-p', password,
    endpoint
  );

  // build
  let image = config.IMAGE;
  if (config.IMAGE.indexOf('/') === -1) {
    const parts = endpoint.split('//');
    if (parts.length === 2) {
      image = parts[1] + '/' + image;
    }
  }

  await build(config, image);
  console.log('Built succesfully');

  await push(config, image);
  console.log('Pushed succesfully');

  // deploy service
  const response = await deployer.deploy(config);
  const revision = getRevision(response.service.taskDefinition);
  console.log(`Service updated to revision ${revision} succesfully`);

  await s3(config, revision);
  console.log('Tag updated succesfully');

}
