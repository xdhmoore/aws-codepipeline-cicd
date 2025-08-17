import { Repository } from 'aws-cdk-lib/aws-codecommit'
import { BuildSpec } from 'aws-cdk-lib/aws-codebuild'
import * as codebuild from 'aws-cdk-lib/aws-codebuild'
import { PolicyStatement } from 'aws-cdk-lib/aws-iam'
import { CodeBuildStep, CodePipeline, CodePipelineSource, ShellStep } from 'aws-cdk-lib/pipelines'
import { CfnOutput, Stack, type StackProps } from 'aws-cdk-lib'
import { type Construct } from 'constructs'
import { Deployment } from './stages'



// Stack:
// arn:aws:cloudformation:us-west-2:178647777806:stack/CodePipeline/9ac351c0-7a41-11f0-89cc-06f8e35f86c5

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

    // Add dev deployment
    const devStage = new Deployment(this, 'Dev')
    pipeline.addStage(devStage, {
      // Execute all sequence of actions before deployment
      pre: [
        new CodeBuildStep('Linting', {
          input: ghUPortalStartConn,
          // installCommands: [
          //   'make warming'
          // ],
          commands: [
            // 'make linting'
            'echo testing dev'
          ]
        }),
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
      ],
      // // Execute validation check for post-deployment
      // post: [
      //   new CodeBuildStep('Validate', {
      //     env: {
      //       STAGE: devStage.stageName
      //     },
      //     installCommands: [
      //       'make warming'
      //     ],
      //     commands: [
      //       'make validate'
      //     ],
      //     rolePolicyStatements: [validatePolicy]
      //   })
      // ]
    })
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
