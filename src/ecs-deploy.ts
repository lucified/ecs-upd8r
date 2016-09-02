import * as AWS from 'aws-sdk';
import * as _ from 'lodash';

import { IConfig } from './config';

const TASKDEFINITION_SUFFIX =  '_taskdefinition.json';
const TAG_SUFFIX =  '_tag';
const REVISION_SUFFIX =  '_revision';


interface Container { image: string; environment: string; name: string; }
interface TaskDefinition {
  family: string;
  volumes?: any;
  containerDefinitions: Container[];
}
interface RegisteredTaskDefinition extends TaskDefinition {
  taskDefinitionArn: string;
  revision: number;
  status: string;
}

let _ecs: any;
function getECS(region?: string) {
  if (!_ecs) {
    const awsecs = new AWS.ECS({ region });
    _ecs = promisifyMethods(awsecs, [
      'describeServices',
      'registerTaskDefinition',
      'updateService',
      'describeTaskDefinition',
    ]);
  }
  return _ecs;
}

let _s3: any;
function getS3(region?: string) {
  if (!_s3) {
    const awss3 = new AWS.S3({ region });
    _s3 = promisifyMethods(awss3, [
      'getObject',
      'putObject',
    ]);
  }
  return _s3;
}

export async function getRegisteredTaskDefinition(config: IConfig): Promise<RegisteredTaskDefinition> {
  const ecs = getECS(config.REGION);

  const result = await ecs.describeServices({
    cluster: config.CLUSTER, services: [config.SERVICE],
  });

  const tdResponse = await ecs.describeTaskDefinition({
    taskDefinition: result.services[0].taskDefinition,
  });

  return tdResponse.taskDefinition;
}



export async function getTaskDefinition(config: IConfig): Promise<TaskDefinition | RegisteredTaskDefinition> {
  const taskDefinition = await getS3Object<TaskDefinition>(config, TASKDEFINITION_SUFFIX);
  if (taskDefinition) {
    console.log(`[INFO] Using taskDefinition from s3`);
    return taskDefinition;
  }
  return getRegisteredTaskDefinition(config);
}



export function getS3TaskDefinition(config: IConfig) {
  return getS3Object<TaskDefinition>(config, TASKDEFINITION_SUFFIX);
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
  return ecs.registerTaskDefinition(taskDefinition)
    .then(result => result.taskDefinition);
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

export async function restartService(config: IConfig, taskDefinition: RegisteredTaskDefinition) {
  const ecs = getECS(config.REGION);
  return ecs.updateService({
    cluster: config.CLUSTER,
    service: config.SERVICE,
    taskDefinition: taskDefinition.taskDefinitionArn,
  });
}

export async function deploy(opts: IConfig) {
  const config = overrideValues(opts, {
    REGION: '',
    CLUSTER: '',
    SERVICE: '',
    CONTAINER: '',
    IMAGE: '',
    IMAGE_TAG: '',
  }) as IConfig;

  const missingValues = falseyKeys(config);
  if (missingValues.length) {
    throw new Error(
      'Error: All configuration values are required.  ' +
      'Missing values: ' + missingValues.join(', ')
    );
  }

  if (opts.BUCKET) {
    config.BUCKET = opts.BUCKET;
  }
  if (opts.KEY) {
    config.KEY = opts.KEY;
  }


  const currentTaskDefinition = await getTaskDefinition(config);
  const currentContainer = getContainer(config.CONTAINER, currentTaskDefinition);
  const nextContainer = updateContainerImage(currentContainer, config.IMAGE!, config.IMAGE_TAG!);
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
      'Missing values: ' + missingValues.join(', ')
    );
  }

  const template = await getS3TaskDefinition(config);
  if (!template) {
    throw new Error("Couldn't find taskDefinition");
  }
  const imageTag = await getS3ImageTag(config);

  const currentContainer = getContainer(config.CONTAINER, template);

  const nextContainer = updateContainerImage(currentContainer, undefined, imageTag);

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
      'Missing values: ' + missingValues.join(', ')
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
    family: taskDefinition.family,
    volumes: taskDefinition.volumes,
    containerDefinitions: taskDefinition.containerDefinitions.map<Container>(function (container) {
      if (container.name === nextContainer.name) {
        return nextContainer;
      }
      return container;
    }),
  };
}

function updateContainerImage(container: Container, image?: string, tag?: string): Container {
  const parts = container.image.split(':');
  const originalTag = parts.pop();
  const originalImage = parts.join(':');
  let nextTag = tag || originalTag;
  let nextImage = image || originalImage;
  return _.assign({}, container, {
    image: nextImage + ':' + nextTag,
  });
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
  });
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
  });
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

function promisifyMethods(obj, methods) {
  methods.forEach((m) => {
    obj[m] = promisify(obj[m], obj);
  });
  return obj;
}

function promisify(fn, context) {
  return function () {
    const args = _.toArray(arguments);
    return new Promise(function (resolve, reject) {
      fn.apply(context, args.concat(function (error, result) {
        if (error) {
          reject(error);
        } else {
          resolve(result);
        }
      }));
    });
  };
}

function upsert(array, keys, item) {
  const id = _.pick(item, keys);
  return _.without(array, _.find(array, id)).concat(item);
}


async function getS3Object<T>(config: IConfig, suffix: string): Promise<T | undefined> {
  if (!config.BUCKET || !config.KEY) {
    return undefined;
  }
  const S3 = getS3(config.REGION);
  const Key = config.KEY + suffix;

  try {
    const response = await S3.getObject({
      Bucket: config.BUCKET,
      Key,
    });
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
