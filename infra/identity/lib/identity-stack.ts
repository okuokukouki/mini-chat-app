// AgentCore Identity（Google OAuth プロバイダー）を作成するスタック。
// OAuth callback URL を SSM に保存し、Google Cloud Console での設定に使用する。
// Token Vault は AgentCore マネージドサービスのため DynamoDB 作成は不要。

import * as cdk from 'aws-cdk-lib';
import * as bedrockagentcore from 'aws-cdk-lib/aws-bedrockagentcore';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { CognitoStack } from './cognito-stack';
import { SecretsStack } from './secrets-stack';

interface IdentityStackProps extends cdk.StackProps {
  cognitoStack: CognitoStack;
  secretsStack: SecretsStack;
}

export class IdentityStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: IdentityStackProps) {
    super(scope, id, props);

    const { secretsStack } = props;

    // Google OAuth クライアント ID / Secret を Secrets Manager から参照
    // unsafeUnwrap() は CloudFormation の {{resolve:secretsmanager:...}} 動的参照を返す
    const clientId = secretsStack.googleOAuthSecret.secretValueFromJson('client_id').unsafeUnwrap();
    const clientSecret = secretsStack.googleOAuthSecret.secretValueFromJson('client_secret').unsafeUnwrap();

    // AgentCore Identity: Google OAuth プロバイダー
    // attrCallbackUrl に自動生成された callback UUID が含まれる → Google Cloud Console に登録する
    const oauthProvider = new bedrockagentcore.CfnOAuth2CredentialProvider(this, 'GmailOAuthProvider', {
      name: 'gmail',
      credentialProviderVendor: 'GoogleOauth2',
      oauth2ProviderConfigInput: {
        googleOauth2ProviderConfig: {
          clientId,
          clientSecret,
        },
      },
    });

    // prevent_destroy 相当: RetainPolicy を設定（callback UUID が固定されるため削除禁止）
    oauthProvider.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);

    // OAuth callback URL を SSM に保存（Runtime の MCP_OAUTH2_CALLBACK_URL 環境変数に使用）
    new ssm.StringParameter(this, 'OAuthCallbackUrlParam', {
      parameterName: '/mini-chat-app/oauth2-callback-url',
      stringValue: oauthProvider.attrCallbackUrl,
      description: 'AgentCore Identity OAuth2 callback URL (register in Google Cloud Console)',
    });

    new cdk.CfnOutput(this, 'OAuthCallbackUrl', {
      value: oauthProvider.attrCallbackUrl,
      description: 'Google OAuth callback URL - Google Cloud Console の承認済みリダイレクト URI に登録すること',
    });
  }
}
