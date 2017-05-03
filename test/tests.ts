import { expect } from 'chai';

import { IConfig } from '../src/config';
import * as ecs from '../src/ecs-deploy';
import { updateTag, Container } from "../src/ecs-deploy";

console.log(`[WARNING] The tests are run against REAL services.
Make sure that the service described by the config is something dispensable.\n`);

let config: IConfig;
try {
  config = require('./config.test');
} catch (err) {
  console.log(`You need to create a "config.test.json" file in the test folder in order to run the tests
(see "config.test.json.example" for reference)`);
  process.exit(0);
}


describe('updateTag', () => {

  it('should replace tag', async () => {
    // Arrange
    const tag = '874_672af8';
    const newTag = 'baz';
    const base = '366857391347.dkr.ecr.eu-west-1.amazonaws.com/charles';
    // Act
    const image = updateTag(`${base}:${tag}`, newTag);
    // Assert
    expect(image).to.eq(`${base}:${newTag}`);
  });

  it('should insert tag', async () => {
    // Arrange
    const newTag = 'baz';
    const base = 'aaa.bb.c/bar';
    // Act
    const image = updateTag(base, newTag);
    // Assert
    expect(image).to.eq(`${base}:${newTag}`);
  });

});
describe('ecs-updater', () => {

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
