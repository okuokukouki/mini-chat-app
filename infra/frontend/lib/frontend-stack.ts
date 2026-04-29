// Amplify Hosting で Next.js フロントエンドをデプロイするスタック。
// GitHub リポジトリと接続し、main ブランチへのプッシュで自動デプロイされる。
// GitHub PAT は Secrets Manager の mini-chat-app/github-token に格納する。

import * as cdk from 'aws-cdk-lib';
import * as amplify from '@aws-cdk/aws-amplify-alpha';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import { Construct } from 'constructs';

// Entra ID アプリ登録情報（フロントエンド環境変数として渡す）
const ENTRA_CLIENT_ID = '4f499ada-09c5-4a58-9c27-356250c69333';
const ENTRA_TENANT_ID = '32b23daa-137d-4054-b9b3-674e256f7a7e';
const AGENTCORE_ENDPOINT =
  'https://miniChatApp_miniChatApp-YHOiZF9NbB.runtime.bedrock-agentcore.us-east-1.amazonaws.com';

export class FrontendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // GitHub PAT を Secrets Manager から取得（デプロイ前に手動で登録が必要）
    const githubToken = cdk.SecretValue.secretsManager('mini-chat-app/github-token');

    // Amplify アプリを作成
    const amplifyApp = new amplify.App(this, 'MiniChatFrontend', {
      appName: 'mini-chat-app',
      sourceCodeProvider: new amplify.GitHubSourceCodeProvider({
        owner: 'okuokukouki',
        repository: 'mini-chat-app',
        oauthToken: githubToken,
      }),
      // Next.js SSR を有効にする
      platform: amplify.Platform.WEB_COMPUTE,
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '1',
        applications: [
          {
            appRoot: 'frontend',
            frontend: {
              phases: {
                preBuild: { commands: ['npm install'] },
                build: { commands: ['npm run build'] },
              },
              artifacts: {
                baseDirectory: '.next',
                files: ['**/*'],
              },
              cache: {
                paths: ['node_modules/**/*'],
              },
            },
          },
        ],
      }),
      environmentVariables: {
        NEXT_PUBLIC_AGENTCORE_ENDPOINT: AGENTCORE_ENDPOINT,
        NEXT_PUBLIC_ENTRA_CLIENT_ID: ENTRA_CLIENT_ID,
        NEXT_PUBLIC_ENTRA_TENANT_ID: ENTRA_TENANT_ID,
        // モノレポ構成でフロントエンドのルートを指定
        AMPLIFY_MONOREPO_APP_ROOT: 'frontend',
      },
    });

    // main ブランチをデプロイ対象に設定
    amplifyApp.addBranch('main', {
      autoBuild: true,
      stage: 'PRODUCTION',
    });

    new cdk.CfnOutput(this, 'AmplifyAppUrl', {
      value: `https://main.${amplifyApp.defaultDomain}`,
      description: 'Amplify フロントエンド URL（Azure リダイレクト URI に登録する）',
    });
  }
}
