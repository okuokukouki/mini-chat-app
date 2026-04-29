// Google OAuth クライアント ID / Secret を保管する Secrets Manager シークレットを作成するスタック。
// 初期値はプレースホルダー。Google Cloud Console でクライアント ID 取得後に実際の値を設定する。

import * as cdk from 'aws-cdk-lib';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export class SecretsStack extends cdk.Stack {
  public readonly googleOAuthSecret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Google OAuth クライアント情報（初期値はプレースホルダー）
    this.googleOAuthSecret = new secretsmanager.Secret(this, 'GoogleOAuthSecret', {
      secretName: 'mini-chat-app/google-oauth',
      description: 'Google OAuth client_id and client_secret for Gmail skill',
      secretObjectValue: {
        client_id: cdk.SecretValue.unsafePlainText('REPLACE_ME'),
        client_secret: cdk.SecretValue.unsafePlainText('REPLACE_ME'),
      },
    });

    new cdk.CfnOutput(this, 'GoogleOAuthSecretArn', { value: this.googleOAuthSecret.secretArn });
  }
}
