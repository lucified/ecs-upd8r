
# ecs-up8r

Runs the whole process of restarting an AWS ECS service with a freshly built Docker image:

1. Login to ECR
2. Build a Docker image
3. Tag the image so that Docker knows to upload it to the ECR repository
4. Push the image to the repository
5. Register a new ECS taskDefinition with a reference to the newly built image
6. Restart the ECS service using the new taskDefinition
7. Upload metadata into an S3 bucket

# Requirements

[AWS credentials](http://docs.aws.amazon.com/AWSJavaScriptSDK/guide/node-configuring.html)
with authorization to perform the needed AWS API calls:

```
ECR.getAuthorizationToken
ECS.describeServices
ECS.describeTaskDefinition
ECS.registerTaskDefinition
ECS.updateService
S3.putObject
```


# Installation

Preferably with NPM:

```shell
npm install -g ecs-upd8r
```

# Configuration

Can read the options from a `ecs-upd8r.json` file. Alternatively
every option can be specified by an environment variable, which have precedence.

```javascript
{
  REGION: '',
  CLUSTER: '',
  SERVICE: '',
  CONTAINER: '',
  IMAGE: '',
  IMAGE_TAG: '',
  BUCKET: '',
  KEY: '',
  DOCKERFILE: 'Dockerfile'
}
```
Every option without a default value is mandatory.

# Usage

```
ecs-upd8r -h
```