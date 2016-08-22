import * as AWS from 'aws-sdk';
import * as _ from 'lodash';

import { IConfig } from './config';

export function deploy(opts: IConfig, onlyTask?: boolean) {
  const config = overrideValues(opts, {
    REGION: '',
    CLUSTER: '',
    SERVICE: '',
    CONTAINER: '',
    IMAGE: '',
    IMAGE_TAG: '',
  });

  const missingValues = falseyKeys(config);
  if (missingValues.length) {
    throw new Error(
      'Error: All configuration values are required.  ' +
      'Missing values: ' + missingValues.join(', ')
    );
  }

  const awsecs = new AWS.ECS({ region: config.REGION });
  const ecs = promisifyMethods(awsecs, [
    'describeServices',
    'registerTaskDefinition',
    'updateService',
    'describeTaskDefinition',
  ]);
  const newTD = ecs.describeServices({
    cluster: config.CLUSTER, services: [config.SERVICE],
  })
    .then(function(result) {
      return ecs.describeTaskDefinition({
        taskDefinition: result.services[0].taskDefinition,
      });
    })
    .then(function(result) {
      const task = result.taskDefinition;
      console.log('Current task definition: ' + task.taskDefinitionArn);
      return ecs.registerTaskDefinition(nextTask(task, config.CONTAINER, config.IMAGE, config.IMAGE_TAG));
    });

  if (onlyTask) {
    return newTD;
  }

  return newTD.then(function(result) {
      const registeredTask = result.taskDefinition;
      console.log('Next task definition: ' + registeredTask.taskDefinitionArn);
      return ecs.updateService({
        cluster: config.CLUSTER,
        service: config.SERVICE,
        taskDefinition: registeredTask.taskDefinitionArn,
      });
    });
}

function nextTask(task, containerName, image, tag) {
  return {
    family: task.family,
    volumes: task.volumes,
    containerDefinitions: task.containerDefinitions.map(function(container) {
      if (container.name === containerName) {
        return nextContainer(container, image, tag);
      }
      return container;
    }),
  };
}

function nextContainer(container, image, tag) {
  return _.assign({}, container, {
    image: image + ':' + tag,
    environment: upsert(container.environment, 'name', {
      name: 'IMAGE_TAG',
      value: tag,
    }),
  });
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
  return function() {
    const args = _.toArray(arguments);
    return new Promise(function(resolve, reject) {
      fn.apply(context, args.concat(function(error, result) {
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
