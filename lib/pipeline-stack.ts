/* eslint-disable @typescript-eslint/comma-dangle */
import { Repository } from 'aws-cdk-lib/aws-codecommit'
import { BuildSpec, LinuxBuildImage } from 'aws-cdk-lib/aws-codebuild'
import * as codebuild from 'aws-cdk-lib/aws-codebuild'
import { Effect, PolicyStatement, ServicePrincipal } from 'aws-cdk-lib/aws-iam'
import * as iam from 'aws-cdk-lib/aws-iam'
import { CodeBuildStep, CodePipeline, CodePipelineSource, ShellStep } from 'aws-cdk-lib/pipelines'
import { CfnOutput, Stack, Stage, type StackProps, RemovalPolicy, pipelines } from 'aws-cdk-lib'
import { Secret } from 'aws-cdk-lib/aws-secretsmanager'
import { type Construct } from 'constructs'
import { Deployment } from './stages'
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { MainStack } from './main-stack'
import { BuildEnvironmentVariableType } from 'aws-cdk-lib/aws-codebuild';
const { SECRETS_MANAGER } = BuildEnvironmentVariableType;


// Stack:
// arn:aws:cloudformation:us-west-2:178647777806:stack/CodePipeline/9ac351c0-7a41-11f0-89cc-06f8e35f86c5

// TODO hook up log groups?
export class CodePipelineStack extends Stack {
  constructor (scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props)

    //   const repo = new Repository(this, 'Repository', {
    //    repositoryName: 'SampleRepository',
    //    description: 'This is sample repository for the project.'
    //  })
    // const gitHubSource = codebuild.Source.gitHub({
    //   owner: 'aws',
    //   webhookTriggersBatchBuild: true, // optional, default is false
    //   webhookFilters: [
    //     codebuild.FilterGroup
    //       .inEventOf(codebuild.EventAction.WORKFLOW_JOB_QUEUED)
    //       .andRepositoryNameIs('aws-.*')
    //       .andRepositoryNameIsNot('aws-cdk-lib'),
    //   ], // optional, by default all pushes and Pull Requests will trigger a build
    // });


    // TODO clean up event bus, and other things
    const validatePolicy = new PolicyStatement({
      actions: [
        'cloudformation:DescribeStacks',
        'events:DescribeEventBus'
      ],
      resources: ['*']
    })


    // TODO make it so these files autoformat
    // TODO make dangling commas acceptable
    // TODO make semicolons acceptable or required
    // TODO fix all these to be main instead of master
    const ghCdkConn = CodePipelineSource.connection(
      'xdhmoore/aws-codepipeline-cicd',
      'main',
      {
        // TODO change ide settings so this doesnt wrap
        connectionArn: 'arn:aws:codeconnections:us-west-2:178647777806:connection/6a90b596-80c0-4341-bdbf-0304dde89f4f',
      }
    );
    const ghUPortalStartConn = CodePipelineSource.connection(
      'xdhmoore/uPortal-start',
      'master',
      {
        // TODO change ide settings so this doesnt wrap
        connectionArn: 'arn:aws:codeconnections:us-west-2:178647777806:connection/6a90b596-80c0-4341-bdbf-0304dde89f4f',
      }
    );
    const gHUPortalConn = CodePipelineSource.connection(
      'xdhmoore/uPortal',
      'master',
      {
        // TODO change ide settings so this doesnt wrap
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
      // 'arn:aws:secretsmanager:us-west-2:178647777806:secret:ecr-pullthroughcache/dev/UPortalDemo/DockerHub'
      'arn:aws:secretsmanager:us-west-2:178647777806:secret:ecr-pullthroughcache/dev/UPortalDemo/DockerHub-9IbD01'
    );

    dockerHubSecret.grantRead(new iam.ServicePrincipal('ecr.amazonaws.com'));

    const cacheRule = new ecr.CfnPullThroughCacheRule(this, 'DockerHubCacheRule', {
      // ecrRepositoryPrefix: 'dockerhub',       // prefix you'll use in image URLs
      upstreamRegistry: 'docker-hub', // Docker Hub registry URL
      upstreamRegistryUrl: 'registry-1.docker.io',

      // credentialArn: 'arn:aws:secretsmanager:us-west-2:178647777806:secret:ecr-pullthroughcache/dev/UPortalDemo/DockerHub-9IbD01'
      // credentialArn: dockerHubSecret.secretArn
      credentialArn: 'arn:aws:secretsmanager:us-west-2:178647777806:secret:ecr-pullthroughcache/dev/UPortalDemo/DockerHub',
      ecrRepositoryPrefix: 'dockerhub'
    });

    const ecrCacheRepo = new ecr.Repository(this, 'CacheEcrRepo', {
      repositoryName: 'uportal-dockerhub-cache-repo',
      removalPolicy: RemovalPolicy.DESTROY, // optional, for dev/testing
      emptyOnDelete: true,

    });

    // TODO put this in the main stack?
    const ecrRepo = new ecr.Repository(this, 'UPortalEcrRepo', {
      repositoryName: 'uportal-repo',
      removalPolicy: RemovalPolicy.DESTROY, // optional, for dev/testing
      emptyOnDelete: true,
    });

    ecrCacheRepo.node.addDependency(cacheRule);



    // Add dev deployment
    // class DevStage extends Stage {
    //   constructor(scope: Construct, id: string, props?: StackProps) {
    //     super(scope, id, props);

    //     new MainStack(this, 'DevMainStack', {
    //       description: 'This is the main stack for the Dev stage.'
    //     });
    //   }
    // }
    // const devStage = new DevStage(this, 'DevStage');


    // 1. Create S3 bucket for commit cache
    const commitCacheBucket = new s3.Bucket(this, 'CommitCacheBucket', {
      removalPolicy: RemovalPolicy.DESTROY, // optional, for dev/testing
      autoDeleteObjects: true,                  // optional, for dev/testing
    });

    const devStage = new Deployment(this, 'Dev');

    // TODO browser notifications when pipeline is done or fails
    // TODO don't run this step unless something in the repo changed. See this maybe:
    // https://docs.aws.amazon.com/codebuild/latest/userguide/build-caching.html
    // This can be done by using a lower level CodeBuildAction, but the api is different
    // in a number of places, so it's non-trivial
    const buildUPortalJava = new CodeBuildStep('BuildUPortalJava', {
      input: ghUPortalStartConn,
      // TODO the cache should depend on the uportal main repo commit as well
      commands: [
        // TODO fix cacheing
        './gradlew tomcatInstall',
        './gradlew tomcatDeploy',
      ],
      // TODO might be faster to do all this in one build step. idk maybe there is cacheing value in keeping them separate
      primaryOutputDirectory: '.',
      buildEnvironment: {
        // buildImage: LinuxBuildImage.fromDockerRegistry('amazoncorretto:8')
        // buildImage: pipelines.CodeBuildStep.code.codeBuildImageFromDockerRegistry(
        buildImage: LinuxBuildImage.AMAZON_LINUX_2_CORETTO_8
      },
      // TODO why am i having so much trouble autoformatting? alt shift f?
      rolePolicyStatements: [
        new PolicyStatement({
          actions: ['s3:GetObject', 's3:PutObject'],
          resources: [commitCacheBucket.arnForObjects('*')],
        })
      ]
    });


    /*
    TODO


FROM gradle:6.9.1-jdk8-hotspot

      check version of xXXX current apereo base image
      check version of MY apereo base image
      if different
        build new image
        push to ECR

    */

    const baseImage = "gradle:6.9.1-jdk8-hotspot";


    // const cacheDockerHubImagesStep = new CodeBuildStep('CacheDockerHubImages', {
    //   buildEnvironment: {
    //     environmentVariables: {
    //       DOCKERHUB_USERNAME: {
    //         type: SECRETS_MANAGER,
    //         value: 'dev/UPortalDemo/DockerHub:username'
    //       },
    //       DOCKERHUB_PASSWORD: {
    //         type: SECRETS_MANAGER,
    //         value: 'dev/UPortalDemo/DockerHub:password'
    //       }
    //     }
    //   },
    //   installCommands: [
    //     'sudo apt-get update',
    //     'sudo apt-get -y install skopeo'
    //   ],
    //   commands: [
    //     `DH_BASE_IMG_DIGEST=$(skopeo inspect --no-tags --creds $DOCKERHUB_USERNAME:$DOCKERHUB_PASSWORD --format "{{ .Digest }}" docker://docker.io/${baseImage})`,

    //     `OUR_BASE_IMG_DIGEST=$(aws ecr describe-images --repository-name ${.repositoryName} --image-ids imageTag=${baseImage} --query 'imageDetails[0].imageDigest' --output text)`,

    //     'echo dh:${DH_BASE_IMG_DIGEST}',
    //     'echo our:${OUR_BASE_IMG_DIGEST}',
    //     `
    //     if [[ "$OUR_BASE_IMG_DIGEST" != "$DH_BASE_IMG_DIGEST" ]]; then
    //       docker pull docker.io/${baseImage};
    //       docker push ${ecrRepo.repositoryUri}/${baseImage};
    //     fi
    //     `
    //   ]
    // })

    const ecrAuthPolicy = new PolicyStatement({
      actions: [
        'ecr:GetAuthorizationToken'
      ],
      resources: ['*']
    });

    const ecrPolicy = new PolicyStatement({
      actions: [
        'ecr:PutImage',
        'ecr:InitiateLayerUpload',
        'ecr:UploadLayerPart',
        'ecr:CompleteLayerUpload',
        'ecr:BatchCheckLayerAvailability',
        'ecr:GetAuthorizationToken',
        'ecr:BatchGetImage',
      ],
      resources: [
        ecrCacheRepo.repositoryArn,
        ecrRepo.repositoryArn,
      ]
    });
    const buildUPortalCliStep = new CodeBuildStep('DockerBuildUPortal-Cli', {
      input: buildUPortalJava,
      // env: {
      //   STAGE: devStack.stackName
      // },
      installCommands: [
        // Install Java 8
        // TODO later version of java?
        // TODO using yum heree and above using apt-get?
        // 'sudo yum install -y java-1.8.0-openjdk java-1.8.0-openjdk-devel',
        // 'export JAVA_HOME=/usr/lib/jvm/jre-1.8.0-openjdk',
        // 'export PATH=$JAVA_HOME/bin:$PATH',
      ],
      commands: [
        // TODO use an image with a running docker daemon inside
        `aws ecr get-login-password --region us-west-2 | docker login --username AWS --password-stdin ${ecrCacheRepo.repositoryUri}`,
        './gradlew dockerBuildImageCli -PdockerMirrorPrefix=' + ecrCacheRepo.repositoryUri + "/dockerhub/",
        // './gradlew dockerBuildImageCli',
        // TODO use version numbers?
        // 'docker build -t uportal-cli:latest ./docker/Dockerfile-cli',
        `aws ecr get-login-password --region us-west-2 | docker login --username AWS --password-stdin ${ecrRepo.repositoryUri}`,
        'docker tag apereo/uportal-cli:latest ' + ecrRepo.repositoryUri + '/apereo/uportal-cli:latest',
        // TODO the docker file in -demo pull sfrom apereo/uportal-cli. Make an alias for it
        'docker push ' + ecrRepo.repositoryUri + '/apereo/uportal-cli:latest',
      ],
      buildEnvironment: {
      privileged: true, // Required for Docker commands
        // buildImage: LinuxBuildImage.fromDockerRegistry('docker:dind')
        buildImage: LinuxBuildImage.AMAZON_LINUX_2_CORETTO_8
      },
      rolePolicyStatements: [
        ecrPolicy,
        ecrAuthPolicy
      ]
    });
    const buildUPortalDemoStep = new CodeBuildStep('DockerBuildUPortal-Demo', {
      input: buildUPortalJava,
      // env: {
      //   STAGE: devStack.stackName
      // },
      installCommands: [
        // Install Java 8
        // TODO later version of java?
        // 'sudo yum install -y java-1.8.0-openjdk java-1.8.0-openjdk-devel',
        // TODO will these will work?
        // 'export JAVA_HOME=/usr/lib/jvm/jre-1.8.0-openjdk',
        // 'export PATH=$JAVA_HOME/bin:$PATH',
      ],
      commands: [
        // TODO change mirrorprifix name to be registry. in this case its not a mirror
        `aws ecr get-login-password --region us-west-2 | docker login --username AWS --password-stdin ${ecrRepo.repositoryUri}`,
        './gradlew dockerBuildImageDemo -PdockerMirrorPrefix=' + ecrRepo.repositoryUri + "/",
        // './gradlew dockerBuildImageDemo',
        // 'docker build -t uportal-demo:latest ./docker/Dockerfile-demo',
        `docker tag apereo/uportal-demo:latest ${ecrRepo.repositoryUri}/apereo/uportal-demo:latest`,
        'docker push ' + ecrRepo.repositoryUri + '/apereo/uportal-demo:latest',
      ],
      buildEnvironment: {
        privileged: true, // Required for Docker commands
        // buildImage: LinuxBuildImage.fromDockerRegistry('docker:dind')
        buildImage: LinuxBuildImage.AMAZON_LINUX_2_CORETTO_8
      },
      rolePolicyStatements: [
        ecrPolicy,
        ecrAuthPolicy
      ]
    });

    // TODO take all this stuff and split it into building functions

    // buildUPortalCliStep.addStepDependency(cacheDockerHubImagesStep);
    buildUPortalCliStep.addStepDependency(buildUPortalJava);
    buildUPortalDemoStep.addStepDependency(buildUPortalJava);
    buildUPortalDemoStep.addStepDependency(buildUPortalCliStep);

    pipeline.addStage(devStage, {
      pre: [
        // cacheDockerHubImagesStep,
        buildUPortalJava,
        buildUPortalCliStep,
        buildUPortalDemoStep
      ],
    });


    // pipeline.addStage(devStage, {
    // // Execute all sequence of actions before deployment
    // pre: [
    //   new CodeBuildStep('Linting', {
    //     input: ghUPortalStartConn,
    //     // installCommands: [
    //     //   'make warming'
    //     // ],
    //     commands: [
    //       // 'make linting'
    //       'echo testing dev'
    //     ]
    //   }),
    //   new CodeBuildStep('UnitTest', {
    //     installCommands: [
    //       'make warming'
    //     ],
    //     commands: [
    //       'make unittest'
    //     ],
    //     partialBuildSpec: BuildSpec.fromObject({
    //       reports: {
    //         coverage: {
    //           files: [
    //             './coverage/clover.xml'
    //           ],
    //           'file-format': 'CLOVERXML'
    //         },
    //         unittest: {
    //           files: [
    //             './test-report.xml'
    //           ],
    //           'file-format': 'JUNITXML'
    //         }
    //       }
    //     }),
    //     rolePolicyStatements: [
    //       new PolicyStatement({
    //         actions: [
    //           'codebuild:CreateReportGroup',
    //           'codebuild:CreateReport',
    //           'codebuild:UpdateReport',
    //           'codebuild:BatchPutTestCases',
    //           'codebuild:BatchPutCodeCoverages'
    //         ],
    //         resources: ['*']
    //       })
    //     ]
    //   }),
    //   new CodeBuildStep('Security', {
    //     installCommands: [
    //       'make warming',
    //       'gem install cfn-nag'
    //     ],
    //     commands: [
    //       'make build',
    //       'make security'
    //     ],
    //     partialBuildSpec: BuildSpec.fromObject({
    //       phases: {
    //         install: {
    //           'runtime-versions': {
    //             ruby: '2.6'
    //           }
    //         }
    //       }
    //     })
    //   })
    // ],
    // stackSteps: [
    //   new CodeBuildStep('Deploy', {
    //     input: ghUPortalStartConn,
    //     env: {
    //       STAGE: devStage.stageName
    //     },
    //     installCommands: [
    //       'make warming'
    // // // Execute validation check for post-deployment
    // // post: [
    // //   new CodeBuildStep('Validate', {
    // //     env: {
    // //       STAGE: devStage.stageName
    // //     },
    // //     installCommands: [
    // //       'make warming'
    // //     ],
    // //     commands: [
    // //       'make validate'
    // //     ],
    // //     rolePolicyStatements: [validatePolicy]
    // //   })
    // // ]
    // })
    // TODO remove Test stage
    // Add test deployment
    const testStage = new Deployment(this, 'Test')
    pipeline.addStage(testStage, {
      // Execute validation check for post-deployment
      post: [
        new CodeBuildStep('Validate', {
          env: {
            STAGE: testStage.stageName
          },
          installCommands: [
            'make warming'
          ],
          commands: [
            'make validate'
          ],
          rolePolicyStatements: [validatePolicy]
        })
      ]
    })
    // Add prod deployment
    const prodStage = new Deployment(this, 'Prod')
    pipeline.addStage(prodStage, {
      // Execute validation check for post-deployment
      post: [
        new CodeBuildStep('Validate', {
          env: {
            STAGE: prodStage.stageName
          },
          installCommands: [
            'make warming'
          ],
          commands: [
            'make validate'
          ],
          rolePolicyStatements: [validatePolicy]
        })
      ]
    })
    // Output
    new CfnOutput(this, 'RepositoryName', {
      value: 'uPortal-start'
    })

    new CfnOutput(this, 'PullThroughURL', {
      value: `public.ecr.aws/${this.account}/${cacheRule.ecrRepositoryPrefix}`,
    });
  }
}
