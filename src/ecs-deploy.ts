import * as AWS from 'aws-sdk';
import * as _debug from 'debug';
import * as _ from 'lodash';
import { inspect } from 'util';

const debug = _debug('ecs-updater');
import { IConfig } from './config';

const TASKDEFINITION_SUFFIX =  '_taskdefinition.json';
const TAG_SUFFIX =  '_tag';
const REVISION_SUFFIX =  '_revision';

export interface Container { image: string; environment: string; name: string; }
export interface TaskDefinition {
  family: string;
  volumes?: any;
  containerDefinitions: Container[];
}
export interface RegisteredTaskDefinition extends TaskDefinition {
  taskDefinitionArn: string;
  revision: number;
  status: string;
}

let _ecs: AWS.ECS;
function getECS(region?: string) {
  if (!_ecs) {
    _ecs = new AWS.ECS({ region });
  }
  return _ecs;
}

let _s3: AWS.S3;
function getS3(region?: string) {
  if (!_s3) {
    _s3 = new AWS.S3({ region });
  }
  return _s3;
}

export async function getRegisteredTaskDefinition(config: IConfig): Promise<RegisteredTaskDefinition> {
  const ecs = getECS(config.REGION);

  const result = await ecs.describeServices({
    cluster: config.CLUSTER!,
    services: [config.SERVICE!],
  }).promise();

  const tdResponse = await ecs.describeTaskDefinition({
    taskDefinition: result.services![0].taskDefinition!,
  }).promise();

  return (tdResponse.taskDefinition as any) as RegisteredTaskDefinition;
}

export async function getTaskDefinition(config: IConfig): Promise<TaskDefinition | RegisteredTaskDefinition> {
  const taskDefinition = await getS3TaskDefinition(config);
  if (taskDefinition) {
    console.log(`[INFO] Using taskDefinition from s3`);
    return taskDefinition;
  }
  return getRegisteredTaskDefinition(config);
}

export async function getS3TaskDefinition(config: IConfig) {
  const taskDefinition = await getS3Object<TaskDefinition>(config, TASKDEFINITION_SUFFIX, config.TASKDEFINITION_KEY);
  if (taskDefinition && typeof taskDefinition !== 'string') {
    return taskDefinition;
  }
  return undefined;
}

export function getS3ImageTag(config: IConfig) {
  return getS3Object<string>(config, TAG_SUFFIX);
}

export function registerTaskDefinition(
  config: IConfig,
  _taskDefinition: TaskDefinition): Promise<RegisteredTaskDefinition> {

  let taskDefinition = _taskDefinition;
  if (isRegistered(_taskDefinition)) {
    taskDefinition = registeredToVanilla(_taskDefinition);
  }
  const ecs = getECS(config.REGION);
  return ecs.registerTaskDefinition(taskDefinition as any).promise()
    .then(result => result.taskDefinition as any);
}

function registeredToVanilla(definition: RegisteredTaskDefinition): TaskDefinition {
  return {
    family: definition.family,
    containerDefinitions: definition.containerDefinitions,
    volumes: definition.volumes,
  };
}

export function isRegistered(
  definition: TaskDefinition | RegisteredTaskDefinition): definition is RegisteredTaskDefinition {
  return (<RegisteredTaskDefinition> definition).taskDefinitionArn !== undefined;
}

export function restartService(config: IConfig, taskDefinition: RegisteredTaskDefinition) {
  const ecs = getECS(config.REGION);
  return ecs.updateService({
    cluster: config.CLUSTER!,
    service: config.SERVICE!,
    taskDefinition: taskDefinition.taskDefinitionArn,
  }).promise();
}

export async function deploy(opts: IConfig) {
  const config = overrideValues(opts, {
    REGION: '',
    CLUSTER: '',
    SERVICE: '',
    CONTAINER: '',
    IMAGE_TAG: '',
  }) as IConfig;

  const missingValues = falseyKeys(config);
  if (missingValues.length) {
    throw new Error(
      'Error: All configuration values are required.  ' +
      'Missing values: ' + missingValues.join(', '),
    );
  }

  if (opts.BUCKET) {
    config.BUCKET = opts.BUCKET;
  }
  if (opts.KEY) {
    config.KEY = opts.KEY;
  }
  if (opts.TASKDEFINITION_KEY) {
    config.TASKDEFINITION_KEY = opts.TASKDEFINITION_KEY;
  }

  const currentTaskDefinition = await getTaskDefinition(config);
  const currentContainer = getContainer(config.CONTAINER, currentTaskDefinition);
  const nextContainer = {
    ...currentContainer,
    image: config.IMAGE_TAG ? updateTag(currentContainer.image, config.IMAGE_TAG) : currentContainer.image,
  };
  const nextTaskDefinition = nextTask(currentTaskDefinition, nextContainer);
  const registeredTaskDefinition = await registerTaskDefinition(config, nextTaskDefinition);

  await restartService(config, registeredTaskDefinition);
  return {
    taskDefinition: registeredTaskDefinition,
    container: nextContainer,
  };
}

export async function terraformRestart(opts: IConfig) {
  const config = overrideValues(opts, {
    REGION: '',
    CLUSTER: '',
    SERVICE: '',
    CONTAINER: '',
    BUCKET: '',
    KEY: '',
  }) as IConfig;

  const missingValues = falseyKeys(config);
  if (missingValues.length) {
    throw new Error(
      'Error: All configuration values are required.  ' +
      'Missing values: ' + missingValues.join(', '),
    );
  }
  if (opts.TASKDEFINITION_KEY) {
    config.TASKDEFINITION_KEY = opts.TASKDEFINITION_KEY;
  }

  const template = await getS3TaskDefinition(config);
  if (!template) {
    throw new Error("Couldn't find taskDefinition");
  }
  const imageTag = await getS3ImageTag(config);
  if (!imageTag) {
    throw new Error("Couldn't find image tag from S3");
  }
  const currentContainer = getContainer(config.CONTAINER, template);
  const nextContainer = {
    ...currentContainer,
    image: updateTag(currentContainer.image, imageTag),
  };

  const nextTaskDefinition = nextTask(template, nextContainer);
  const registeredTaskDefinition = await registerTaskDefinition(config, nextTaskDefinition);

  await restartService(config, registeredTaskDefinition);
  return {
    taskDefinition: registeredTaskDefinition,
    container: nextContainer,
  };
}

export async function restart(opts: IConfig) {
  const config = overrideValues(opts, {
    REGION: '',
    CLUSTER: '',
    SERVICE: '',
  }) as IConfig;

  const missingValues = falseyKeys(config);
  if (missingValues.length) {
    throw new Error(
      'Error: All configuration values are required.  ' +
      'Missing values: ' + missingValues.join(', '),
    );
  }

  const template = await getRegisteredTaskDefinition(config);
  const registeredTaskDefinition = await registerTaskDefinition(config, template);

  await restartService(config, registeredTaskDefinition);
  return {
    current: registeredTaskDefinition,
    previous: template,
  };
}

function getContainer(containerName, taskDefinition: TaskDefinition) {
  const containers = taskDefinition.containerDefinitions.filter(container => container.name === containerName);
  if (containers.length === 0) {
    throw new Error(`The taskDefinition didn't have a container named ${containerName}`);
  }
  return containers[0];
}

function nextTask(taskDefinition: TaskDefinition, nextContainer: Container): TaskDefinition {
  return {
    ...taskDefinition,
    containerDefinitions: taskDefinition.containerDefinitions.map((container) => {
      if (container.name === nextContainer.name) {
        return nextContainer;
      }
      return container;
    }),
  };
}

export function updateTag(image: string, tag: string) {
  const parts = /^(https?:\/\/)?([\w-_.\/]+)(:\w+)?$/.exec(image);
  if (!parts) {
    throw new Error(`Invalid container image: ${image}`);
  }
  const newImage = (parts[1] || '') + parts[2] + ':' + tag;
  debug('Replacing image %s with %s', image, newImage);
  return newImage;
}

export async function syncRevision(config: IConfig, taskDefinition: RegisteredTaskDefinition) {
  if (!config.BUCKET || !config.KEY) {
    throw new Error(`Can't syncRevision since BUCKET or KEY is not set`);
  }
  const S3 = getS3(config.REGION);
  const revision = taskDefinition.revision;
  const revisionKey = config.KEY + REVISION_SUFFIX;
  await S3.putObject({
    Bucket: config.BUCKET,
    Key: revisionKey,
    ContentType: 'text/plain',
    Body: String(revision),
  }).promise();
  console.log(`s3://${config.BUCKET}/${revisionKey} => ${revision}`);
}

export async function syncImageTag(config: IConfig, container: Container) {
  if (!config.BUCKET || !config.KEY) {
    throw new Error(`Can't syncImageTag since BUCKET or KEY is not set`);
  }
  const S3 = getS3(config.REGION);
  const tag = getTag(container.image);
  const tagKey = config.KEY + '_tag';
  await S3.putObject({
    Bucket: config.BUCKET,
    Key: tagKey,
    ContentType: 'text/plain',
    Body: tag,
  }).promise();
  console.log(`s3://${config.BUCKET}/${tagKey} => ${tag}`);
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

export function overrideValues(overrides, defaults) {
  return _.assign({}, defaults, _.pick(overrides, _.keys(defaults)));
}

function falseyKeys(obj) {
  return Object.keys(obj).filter(k => obj[k] === '');
}

function upsert(array, keys, item) {
  const id = _.pick(item, keys);
  return _.without(array, _.find(array, id)).concat(item);
}

async function getS3Object<T>(config: IConfig, suffix?: string, key?: string): Promise<T | string | undefined> {
  if (!config.BUCKET || !config.KEY) {
    return undefined;
  }
  const S3 = getS3(config.REGION);
  const Key = key ? key : config.KEY + suffix;

  try {
    const response = await S3.getObject({
      Bucket: config.BUCKET,
      Key,
    }).promise();
    let body = response.Body;
    if (Buffer.isBuffer(body)) {
      body = body.toString();
    }
    if (_.isString(body)) {
      if (response.ContentType && response.ContentType.indexOf('json') !== -1) {
        return JSON.parse(body);
      }
      return body;
    }
  } catch (err) {
    console.log(err);
    console.log(`[INFO] Couldn\'t find s3://${config.BUCKET}/${Key}`);
  }
  return undefined;
}
