// Cognito User Pool と User Pool Client を作成するスタック。
// フロントエンド認証の基盤。JWT 発行元として AgentCore Runtime の CUSTOM_JWT 認証に使用する。

import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export class CognitoStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Cognito User Pool（メール/パスワード認証）
    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: 'mini-chat-app-user-pool',
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // User Pool Client（フロントエンド用、PKCE 対応、シークレットなし）
    this.userPoolClient = this.userPool.addClient('WebClient', {
      userPoolClientName: 'mini-chat-app-web-client',
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      generateSecret: false,
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
      },
    });

    // テストユーザーの作成（Custom Resource）
    const testUserEmail = this.node.tryGetContext('testUserEmail') ?? 'test@example.com';
    const testUserPassword = this.node.tryGetContext('testUserPassword') ?? 'Test1234!';

    const createUserRole = new iam.Role(this, 'CreateUserRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });
    createUserRole.addToPolicy(new iam.PolicyStatement({
      actions: ['cognito-idp:AdminCreateUser', 'cognito-idp:AdminSetUserPassword'],
      resources: [this.userPool.userPoolArn],
    }));

    new cr.AwsCustomResource(this, 'TestUser', {
      onCreate: {
        service: 'CognitoIdentityServiceProvider',
        action: 'adminCreateUser',
        parameters: {
          UserPoolId: this.userPool.userPoolId,
          Username: testUserEmail,
          TemporaryPassword: testUserPassword,
          MessageAction: 'SUPPRESS',
        },
        physicalResourceId: cr.PhysicalResourceId.of(`test-user-${testUserEmail}`),
      },
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          actions: ['cognito-idp:AdminCreateUser'],
          resources: [this.userPool.userPoolArn],
        }),
      ]),
    });

    // SSM に User Pool ID と Client ID を保存
    new ssm.StringParameter(this, 'UserPoolIdParam', {
      parameterName: '/mini-chat-app/cognito-user-pool-id',
      stringValue: this.userPool.userPoolId,
    });

    new ssm.StringParameter(this, 'UserPoolClientIdParam', {
      parameterName: '/mini-chat-app/cognito-client-id',
      stringValue: this.userPoolClient.userPoolClientId,
    });

    new cdk.CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: this.userPoolClient.userPoolClientId });
  }
}
