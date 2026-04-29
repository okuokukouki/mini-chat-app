// AgentCore Runtime をデプロイし、エンドポイント URL を SSM に保存するスタック。
// Entra ID の OIDC エンドポイントを使い CUSTOM_JWT 認証を設定する。

import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { AgentCoreApplication } from '@aws/agentcore-cdk';
import type { DirectoryPath, FilePath } from '@aws/agentcore-cdk';
import { Construct } from 'constructs';

// Entra ID アプリ登録情報
const ENTRA_TENANT_ID = '32b23daa-137d-4054-b9b3-674e256f7a7e';
const ENTRA_CLIENT_ID = '4f499ada-09c5-4a58-9c27-356250c69333';

export class RuntimeStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Entra ID の OIDC discovery URL（CUSTOM_JWT 認証に使用）
    const entraDiscoveryUrl = `https://login.microsoftonline.com/${ENTRA_TENANT_ID}/v2.0/.well-known/openid-configuration`;

    // AgentCore Application を作成（役割・コードの zip 化・Runtime リソースを自動生成）
    const agentApp = new AgentCoreApplication(this, 'AgentCore', {
      spec: {
        name: 'miniChatApp',
        version: 1,
        managedBy: 'CDK',
        runtimes: [
          {
            name: 'miniChatApp',
            build: 'CodeZip',
            entrypoint: 'main.py' as FilePath,
            codeLocation: 'agentcore/src/' as DirectoryPath,
            runtimeVersion: 'PYTHON_3_14',
            networkMode: 'PUBLIC',
            protocol: 'HTTP',
            requestHeaderAllowlist: ['Authorization'],
            authorizerType: 'CUSTOM_JWT',
            authorizerConfiguration: {
              customJwtAuthorizer: {
                discoveryUrl: entraDiscoveryUrl,
                allowedAudience: [ENTRA_CLIENT_ID],
              },
            },
          },
        ],
        credentials: [
          {
            authorizerType: 'OAuthCredentialProvider',
            name: 'gmail',
            vendor: 'GoogleOauth2',
            scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
          },
        ],
        memories: [],
        evaluators: [],
        onlineEvalConfigs: [],
        agentCoreGateways: [],
        policyEngines: [],
      },
    });

    const env = agentApp.environments.get('miniChatApp');
    if (!env) {
      throw new Error('AgentCoreApplication に miniChatApp 環境が見つかりません。');
    }

    // Secrets Manager 読み取り権限（Tavily API キー / Google OAuth）
    env.runtime.addToPolicy(
      new iam.PolicyStatement({
        actions: ['secretsmanager:GetSecretValue'],
        resources: [`arn:aws:secretsmanager:${this.region}:${this.account}:secret:mini-chat-app/*`],
      }),
    );

    // SSM 読み取り権限（Gateway エンドポイント URL を起動時に取得）
    env.runtime.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter'],
        resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/mini-chat-app/*`],
      }),
    );

    // AgentCore ビルトインツール権限（Code Interpreter / Browser）
    env.runtime.addToPolicy(
      new iam.PolicyStatement({
        actions: ['bedrock-agentcore:*'],
        resources: ['*'],
      }),
    );

    // Runtime エンドポイント URL を SSM に保存（フロントエンドが参照）
    // runtimeId にアンダースコアが含まれ DNS ホスト名として無効なため、ARN をパスに URL エンコードする形式を使用
    // 形式: https://bedrock-agentcore.<region>.amazonaws.com/runtimes/<encodedArn>
    const colonReplaced = cdk.Fn.join('%3A', cdk.Fn.split(':', env.runtime.runtimeArn));
    const encodedArn = cdk.Fn.join('%2F', cdk.Fn.split('/', colonReplaced));
    const runtimeEndpointUrl = cdk.Fn.join('', [
      'https://bedrock-agentcore.',
      this.region,
      '.amazonaws.com/runtimes/',
      encodedArn,
    ]);

    new ssm.StringParameter(this, 'RuntimeEndpointParam', {
      parameterName: '/mini-chat-app/runtime-endpoint',
      stringValue: runtimeEndpointUrl,
      description: 'AgentCore Runtime endpoint URL',
    });

    new cdk.CfnOutput(this, 'RuntimeId', { value: env.runtime.runtimeId });
    new cdk.CfnOutput(this, 'RuntimeArn', { value: env.runtime.runtimeArn });
    new cdk.CfnOutput(this, 'RuntimeEndpointUrl', {
      value: runtimeEndpointUrl,
      exportName: 'MiniChatRuntimeEndpointUrl',
    });
  }
}
