import { LinuxBuildImage, Cache } from 'aws-cdk-lib/aws-codebuild'
import { PolicyStatement } from 'aws-cdk-lib/aws-iam'
import * as iam from 'aws-cdk-lib/aws-iam'
import { CodeBuildStep, CodePipeline, CodePipelineSource, ShellStep } from 'aws-cdk-lib/pipelines'
import { CfnOutput, Stack, type StackProps, RemovalPolicy } from 'aws-cdk-lib'
import { Secret } from 'aws-cdk-lib/aws-secretsmanager'
import { type Construct } from 'constructs'
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as s3 from 'aws-cdk-lib/aws-s3';

export class CodePipelineStack extends Stack {
  constructor (scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props)

    const ghCdkConn = CodePipelineSource.connection(
      'xdhmoore/aws-codepipeline-cicd',
      'main',
      {
        connectionArn: 'arn:aws:codeconnections:us-west-2:178647777806:connection/6a90b596-80c0-4341-bdbf-0304dde89f4f',
      }
    );
    const ghUPortalStartConn = CodePipelineSource.connection(
      'xdhmoore/uPortal-start',
      'master',
      {
        connectionArn: 'arn:aws:codeconnections:us-west-2:178647777806:connection/6a90b596-80c0-4341-bdbf-0304dde89f4f',
      }
    );

    const pipeline = new CodePipeline(this, 'Pipeline', {
      crossAccountKeys: true,
      enableKeyRotation: true,
      synth: new ShellStep('Synth', {
        input: ghCdkConn,
        installCommands: [
          'make warming'
        ],
        commands: [
          'make build'
        ]
      })
    })
    const dockerHubSecret = Secret.fromSecretCompleteArn(
      this,
      'DockerHubSecret',
      'arn:aws:secretsmanager:us-west-2:178647777806:secret:ecr-pullthroughcache/dev/UPortalDemo/DockerHub-9IbD01'
    );

    dockerHubSecret.grantRead(new iam.ServicePrincipal('ecr.amazonaws.com'));

    const cacheRule = new ecr.CfnPullThroughCacheRule(this, 'DockerHubCacheRule', {
      upstreamRegistry: 'docker-hub',
      upstreamRegistryUrl: 'registry-1.docker.io',
      credentialArn: 'arn:aws:secretsmanager:us-west-2:178647777806:secret:ecr-pullthroughcache/dev/UPortalDemo/DockerHub',
      ecrRepositoryPrefix: 'dockerhub'
    });

    const ecrCliRepo = new ecr.Repository(this, 'UPortalCliEcrRepo', {
      repositoryName: 'apereo/uportal-cli',
      removalPolicy: RemovalPolicy.DESTROY,
      emptyOnDelete: true,
    });

    const ecrDemoRepo = new ecr.Repository(this, 'UPortalDemoEcrRepo', {
      repositoryName: 'apereo/uportal-demo',
      removalPolicy: RemovalPolicy.DESTROY,
      emptyOnDelete: true,
    });

    const ecrUri = `${this.account}.dkr.ecr.us-west-2.amazonaws.com`;
    const ecrCachedImagesArn = `arn:aws:ecr:${this.region}:${this.account}:repository/dockerhub/*`;


    const commitCacheBucket = new s3.Bucket(this, 'CommitCacheBucket', {
      removalPolicy: RemovalPolicy.DESTROY, // optional, for dev/testing
      autoDeleteObjects: true,                  // optional, for dev/testing
    });

    const buildUPortalJava = new CodeBuildStep('BuildUPortalJava', {
      input: ghUPortalStartConn,
      commands: [
        './gradlew tomcatInstall',
        './gradlew tomcatDeploy',
      ],
      primaryOutputDirectory: '.',
      buildEnvironment: {
        buildImage: LinuxBuildImage.AMAZON_LINUX_2_CORETTO_8
      },
      cache: Cache.bucket(commitCacheBucket, {
        prefix: 'uportal-java-cache'
      }),
      rolePolicyStatements: [
        new PolicyStatement({
          actions: ['s3:GetObject', 's3:PutObject'],
          resources: [commitCacheBucket.arnForObjects('*')],
        })
      ]
    });


    const baseImage = "gradle:6.9.1-jdk8-hotspot";

    const ecrAuthPolicy = new PolicyStatement({
      actions: [
        'ecr:GetAuthorizationToken'
      ],
      resources: ['*']
    });

    const ecrPolicy = new PolicyStatement({
      actions: [
        'ecr:BatchCheckLayerAvailability',
        'ecr:BatchGetImage',
        'ecr:CompleteLayerUpload',
        'ecr:CreateRepository',
        'ecr:GetAuthorizationToken',
        'ecr:GetDownloadUrlForLayer',
        'ecr:InitiateLayerUpload',
        'ecr:PutImage',
        'ecr:UploadLayerPart',
      ],
      resources: [
        ecrCachedImagesArn,
        ecrDemoRepo.repositoryArn,
        ecrDemoRepo.repositoryArn + "/*",
        ecrCliRepo.repositoryArn,
        ecrCliRepo.repositoryArn + "/*",
      ]
    });

    const dockerBaseImageCli = 'gradle:6.9.1-jdk8-hotspot';
    const buildUPortalCliStep = new CodeBuildStep('DockerBuildUPortal-Cli', {
      input: buildUPortalJava,
      commands: [
        `aws ecr get-login-password --region us-west-2 | docker login --username AWS --password-stdin ${ecrUri}`,
        `./gradlew dockerBuildImageCli -PdockerMirrorPrefix=${ecrUri}/dockerhub/library/` + ` -PbaseImage=${dockerBaseImageCli}`,
        'docker tag apereo/uportal-cli:latest ' + ecrCliRepo.repositoryUri + ':latest',
        'docker push ' + ecrCliRepo.repositoryUri + ':latest',
      ],
      buildEnvironment: {
      privileged: true,
        buildImage: LinuxBuildImage.AMAZON_LINUX_2_CORETTO_8
      },
      rolePolicyStatements: [
        ecrPolicy,
        ecrAuthPolicy
      ]
    });
    const buildUPortalDemoStep = new CodeBuildStep('DockerBuildUPortal-Demo', {
      input: buildUPortalJava,
      commands: [
        `aws ecr get-login-password --region us-west-2 | docker login --username AWS --password-stdin ${ecrUri}`,
        './gradlew dockerBuildImageDemo -PdockerMirrorPrefix=' + ecrCliRepo.registryUri + "/",
        `docker tag apereo/uportal-demo:latest ${ecrDemoRepo.repositoryUri}:latest`,
        'docker push ' + ecrDemoRepo.repositoryUri + ':latest',
      ],
      buildEnvironment: {
        privileged: true, // Required for Docker commands
        buildImage: LinuxBuildImage.AMAZON_LINUX_2_CORETTO_8
      },
      rolePolicyStatements: [
        ecrPolicy,
        ecrAuthPolicy
      ]
    });

    buildUPortalCliStep.addStepDependency(buildUPortalJava);
    buildUPortalDemoStep.addStepDependency(buildUPortalJava);
    buildUPortalDemoStep.addStepDependency(buildUPortalCliStep);


    pipeline.addWave('Dev', {
      pre: [
        buildUPortalJava,
        buildUPortalCliStep,
        buildUPortalDemoStep
      ],
    });

    new CfnOutput(this, 'RepositoryName', {
      value: 'uPortal-start'
    })

    new CfnOutput(this, 'PullThroughURL', {
      value: `public.ecr.aws/${this.account}/${cacheRule.ecrRepositoryPrefix}`,
    });
  }
}
