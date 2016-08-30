import { expect } from 'chai';

import * as ecs from '../src/ecs-deploy';
import config from './config.test';

describe('ecs-upd8r', () => {

  it('can re-register a taskDefinition', async () => {


    const td = await ecs.getTaskDefinition(config);
    const td2 = await ecs.registerTaskDefinition(config, td);
    expect(td.taskDefinitionArn).to.not.eq(td2.taskDefinitionArn);

  });

  it('can restart a service', async () => {


    const {current, previous} = await ecs.restart(config);
    await ecs.syncRevision(config, current);
    expect(current.revision).to.exist;
    expect(previous.revision).to.exist;
    expect(current.revision).to.be.gt(previous.revision);

  });



});