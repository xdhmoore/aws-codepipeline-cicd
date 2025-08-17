/* eslint-disable @typescript-eslint/comma-dangle */
import { Repository } from 'aws-cdk-lib/aws-codecommit'
import { BuildSpec, LinuxBuildImage } from 'aws-cdk-lib/aws-codebuild'
import * as codebuild from 'aws-cdk-lib/aws-codebuild'
import { PolicyStatement } from 'aws-cdk-lib/aws-iam'
import { CodeBuildStep, CodePipeline, CodePipelineSource, ShellStep } from 'aws-cdk-lib/pipelines'
import { CfnOutput, Stack, Stage, type StackProps, RemovalPolicy, pipelines } from 'aws-cdk-lib'
import { type Construct } from 'constructs'
import { Deployment } from './stages'
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { MainStack } from './main-stack'



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
    const ghCdkConn = CodePipelineSource.connection(
      'xdhmoore/aws-codepipeline-cicd',
      'main',
      {
        // TODO change ide settings so this doesnt wrap
        connectionArn: 'arn:aws:codeconnections:us-west-2:178647777806:connection/6a90b596-80c0-4341-bdbf-0304dde89f4f'

      }
    );
    const ghUPortalStartConn = CodePipelineSource.connection(
      'xdhmoore/uPortal-start',
      'master',
      {
        // TODO change ide settings so this doesnt wrap
        connectionArn: 'arn:aws:codeconnections:us-west-2:178647777806:connection/6a90b596-80c0-4341-bdbf-0304dde89f4f'

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

    // TODO put this in the main stack?
    const ecrRepo = new ecr.Repository(this, 'UPortalECRRepo');

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


    // TODO don't run this step unless something in the repo changed. See this maybe:
    // https://docs.aws.amazon.com/codebuild/latest/userguide/build-caching.html
    const buildUPortalJava = new CodeBuildStep('BuildUPortalJava', {
      input: ghUPortalStartConn,

      // TODO the cache should depend on the uportal main repo commit as well
      commands: [
        // TODO fix cacheing
        /*
        `aws s3 cp s3://${commitCacheBucket.bucketName}/last-build-commit.txt last-build-commit.txt || echo "none" > last-build-commit.txt`,
        // Fetch previous commit from S3 (or default to 'none')
        // Compare with current commit
        'CURRENT_COMMIT=$(git rev-parse HEAD)',
        'LAST_COMMIT=$(cat last-build-commit.txt)',
        'if [ "$CURRENT_COMMIT" = "$LAST_COMMIT" ]; then echo "No new commit. Skipping build."; exit 0; fi',
        // TODO pull from the latest uportal gradle binaries to see if any changed. this could be a lot of them...
*/

        // Install Java 8
        // TODO later version of java?
        // 'sudo yum install -y java-1.8.0-openjdk java-1.8.0-openjdk-devel',
        // 'export JAVA_HOME=/usr/lib/jvm/jre-1.8.0-openjdk',
        // 'export PATH=$JAVA_HOME/bin:$PATH',

        // Run your build
        './gradlew tomcatInstall',
        './gradlew tomcatDeploy',

        /*
        // Update commit SHA in local file and push to S3
        'echo $CURRENT_COMMIT > last-build-commit.txt',
        `aws s3 cp last-build-commit.txt s3://${commitCacheBucket.bucketName}/last-build-commit.txt`
        */
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

    const baseImage = "grradle:6.9.1-jdk8-hotspot";


    const cacheDockerHubImages = new CodeBuildStep('CacheDockerHubImages', {
      installCommands: [
        'sudo apt-get update',
        'sudo apt-get -y install skopeo'
      ],
      commands: [
        `skopeo inspect docker://docker.io/apereo/${baseImage}`,
        'echo ====================',
        `skopeo inspect docker://${ecrRepo.repositoryUri}/${baseImage}`,
      ]
    })


    const buildUPortalCliStep = new CodeBuildStep('DockerBuildUPortal-Cli', {
      input: buildUPortalJava,
      // env: {
      //   STAGE: devStack.stackName
      // },
      installCommands: [
        // Install Java 8
        // TODO later version of java?
        // TODO using yum heree and above using apt-get?
        'sudo yum install -y java-1.8.0-openjdk java-1.8.0-openjdk-devel',
        'export JAVA_HOME=/usr/lib/jvm/jre-1.8.0-openjdk',
        'export PATH=$JAVA_HOME/bin:$PATH',
      ],
      commands: [
      // TODO use an image with a running docker daemon inside
      './gradlew dockerBuildImageCli',
      // TODO use version numbers?
        // 'docker build -t uportal-cli:latest ./docker/Dockerfile-cli',
        // TODO the docker file in -demo pull sfrom apereo/uportal-cli. Make an alias for it
      'docker push ' + ecrRepo.repositoryUri + '/uportal-cli:latest',
      ],
      buildEnvironment: {
      privileged: true, // Required for Docker commands
        // buildImage: LinuxBuildImage.fromDockerRegistry('docker:dind')
        buildImage: LinuxBuildImage.AMAZON_LINUX_2_CORETTO_8
      }
    });
    const buildUPortalDemoStep = new CodeBuildStep('DockerBuildUPortal-Demo', {
      input: buildUPortalJava,
      // env: {
      //   STAGE: devStack.stackName
      // },
      installCommands: [
        // Install Java 8
        // TODO later version of java?
        'sudo yum install -y java-1.8.0-openjdk java-1.8.0-openjdk-devel',
        'export JAVA_HOME=/usr/lib/jvm/jre-1.8.0-openjdk',
        'export PATH=$JAVA_HOME/bin:$PATH',
      ],
      commands: [
        './gradlew dockerBuildImageDemo',
        // 'docker build -t uportal-demo:latest ./docker/Dockerfile-demo',
        'docker push ' + ecrRepo.repositoryUri + '/uportal-demo:latest',
      ],
      buildEnvironment: {
        privileged: true, // Required for Docker commands
        // buildImage: LinuxBuildImage.fromDockerRegistry('docker:dind')
        buildImage: LinuxBuildImage.AMAZON_LINUX_2_CORETTO_8
      },

    });

    buildUPortalCliStep.addStepDependency(buildUPortalJava);
    buildUPortalDemoStep.addStepDependency(buildUPortalJava);
    buildUPortalDemoStep.addStepDependency(buildUPortalCliStep);

    pipeline.addStage(devStage, {
      pre: [
        buildUPortalJava,
        buildUPortalCliStep,
        buildUPortalDemoStep
      ]
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
  }
}
