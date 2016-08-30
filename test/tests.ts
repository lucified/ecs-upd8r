import { expect } from 'chai';

import * as ecs from '../src/ecs-deploy';
import config from './config.test';

describe('ecs-upd8r', () => {

  it('can re-register a taskDefinition', async () => {


    const previous = await ecs.getRegisteredTaskDefinition(config);
    const current = await ecs.registerTaskDefinition(config, previous);
    expect(current.revision).to.be.gt(previous.revision);

  });

  it('can restart a service', async () => {

    const {current, previous} = await ecs.restart(config);
    await ecs.syncRevision(config, current);
    expect(current.revision).to.exist;
    expect(previous.revision).to.exist;
    expect(current.revision).to.be.gt(previous.revision);

  });

  it('can retrieve a taskDefinition from S3', async () => {

    const response = await ecs.getS3TaskDefinition(config);
    expect(response).to.exist;
    expect(response!.family).to.exist;

  });

  it('can retrieve the image tag from S3', async () => {

    const response = await ecs.getS3ImageTag(config);
    expect(response).to.exist;

  });


});