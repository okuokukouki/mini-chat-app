// IAM ロールと Secrets Manager リソースを作成するスタック。
// GatewayStack から参照されるリソースを出力として公開する。

import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export class IamStack extends cdk.Stack {
  public readonly lambdaRole: iam.Role;
  public readonly gatewayRole: iam.Role;
  public readonly tavilySecret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Tavily API キー保管用シークレット（値はダミー、デプロイ後 CLI で設定）
    this.tavilySecret = new secretsmanager.Secret(this, 'TavilySecret', {
      secretName: 'mini-chat-app/tavily-api-key',
      description: 'Tavily API key for mini-chat-app',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ TAVILY_API_KEY: 'REPLACE_ME' }),
        generateStringKey: '_unused',
        excludeCharacters: '"@/\\',
      },
    });

    // Lambda 実行ロール
    this.lambdaRole = new iam.Role(this, 'LambdaRole', {
      roleName: 'mini-chat-app-tavily-lambda-role',
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });
    this.lambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
      resources: ['arn:aws:logs:*:*:*'],
    }));
    // シークレット ARN にはランダムサフィックスが付くのでワイルドカードで許可
    this.lambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: ['secretsmanager:GetSecretValue'],
      resources: [`${this.tavilySecret.secretArn}*`],
    }));

    // AgentCore Gateway 実行ロール（Lambda を呼び出す権限）
    this.gatewayRole = new iam.Role(this, 'GatewayRole', {
      roleName: 'mini-chat-app-gateway-role',
      assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
    });
    this.gatewayRole.addToPolicy(new iam.PolicyStatement({
      actions: ['lambda:InvokeFunction'],
      resources: [`arn:aws:lambda:${this.region}:${this.account}:function:mcp-*`],
    }));

    new cdk.CfnOutput(this, 'TavilySecretArn', { value: this.tavilySecret.secretArn });
    new cdk.CfnOutput(this, 'LambdaRoleArn', { value: this.lambdaRole.roleArn });
    new cdk.CfnOutput(this, 'GatewayRoleArn', { value: this.gatewayRole.roleArn });
  }
}
