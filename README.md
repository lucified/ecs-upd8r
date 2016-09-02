
# ecs-updater

A Node.js CLI utility for updating and restarting AWS Elastic Container Service services.

# Requirements

[AWS credentials](http://docs.aws.amazon.com/AWSJavaScriptSDK/guide/node-configuring.html)
with authorization to perform the needed AWS API calls, corresponding to the following policy:

```
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ecr:*"
      ],
      "Resource": "*"
    },
    {
      "Action": [
        "ecs:describeServices",
        "ecs:describeTaskDefinition",
        "ecs:registerTaskDefinition",
        "ecs:updateService"
      ],
      "Resource": [
        "*"
      ],
      "Effect": "Allow"
    },
    {
      "Sid": "",
      "Effect":"Allow",
      "Action":[
        "s3:GetObject",
        "s3:PutObject",
      ],
      "Resource":"arn:aws:s3:::${bucket}/${path}/*"
    }
  ]
}
```

For operations involving Docker Hub, you will also have
to be logged in into Docker Hub.

# Installation

Preferably with NPM:

```shell
npm install -g ecs-updater
```

# Configuration

Reads options from a `ecs-updater.json` file in the current working directory.
Following options are available:

- `REGION`: AWS region. Defaults to `eu-west-1`.
- `CLUSTER`: AWS cluster name, for example `default`.
- `SERVICE`: ECS service name, for example `heaven`.
- `CONTAINER`: Container name in the ECS service task definition, for example `heaven`.
- `IMAGE`: ECR repository name (for example `heaven`) or Docker Hub image name (for example `lucified/heaven`).
- `BUCKET`: Bucket in which we store the following:
  - `[KEY]_tag`: Text file with newest image tag for this Docker image (written by ecs-updater).
  - `[KEY]_revision`: Text file with newest revision for the ECS service task definition (written by ecs-updater).
  - `[KEY]_taskdefinition.json`: Task definition for this serice (read by ecs-updater, written by terraform).
- `KEY`: Key to use for files stored in bucket. This can also contain a path, such as `ecs_services/heaven`.
- `DOCKERFILE`: Dockerfile to use when building Docker image. Defaults to `Dockerfile`.

Alternatively every option can be specified by an environment variable, which have precedence.

Example:
```javascript
{
  REGION: 'eu-west-1',
  CLUSTER: 'default',
  SERVICE: 'heaven',
  CONTAINER: 'heaven',
  IMAGE: 'lucified/heaven',
  BUCKET: '',
  KEY: '',
  DOCKERFILE: 'Dockerfile'
}


```
Every option without a default value is mandatory, except `IMAGE_TAG`.
If the command is run inside a git repository, the tag will be
a shortened SHA1 of the HEAD commit.

# Usage

## Default action

```
ecs-updater
```

This will:

1. Login to ECR
2. Build a Docker image
3. Tag the image so that Docker knows to upload it to the ECR repository or Docker hub
4. Push the image to the repository or Docker hub
5. Register a new ECS taskDefinition with a reference to the newly built image
6. Restart the ECS service using the new taskDefinition
7. Upload metadata into an S3 bucket

To run this command, all of the options listed in the configuration section
need to be defined, expect for options that have defaults.

## Restart

```
ecs-updater -s restart-terraform
```

This will load the most recent task definition from `s3://[BUCKET]/[KEY]_taskdefinition.json and
increment its revision, which will cause the service to restart with an updated task definition.
The revision and tag information will be updated to the s3 bucket.

To run this command, all of the following options need to be defined:
- `REGION`
- `CLUSTER`
- `SERVICE`
- `CONTAINER`
- `BUCKET`
- `KEY`

## Build

```
ecs-updater -s build
```

To run this command, all of the following options need to be defined:
- `IMAGE`
- `DOCKERFILE`

## Plain restart (advanced)

```
ecs-updater -s restart-service
```

This will load the most recent task definition from AWS and increment its revision, which will cause
the service to restart. To run this command, all of the following options need to be defined:
- `REGION`
- `CLUSTER`
- `SERVICE`

This will not update the revision and tag information to the S3 bucket, which will
cause Terraform to be out-of-sync. You will need to resolve that manually.

