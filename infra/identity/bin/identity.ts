#!/usr/bin/env node
// CDK App エントリポイント。CognitoStack → SecretsStack → IdentityStack の順にデプロイする。

import * as cdk from 'aws-cdk-lib';
import { CognitoStack } from '../lib/cognito-stack';
import { SecretsStack } from '../lib/secrets-stack';
import { IdentityStack } from '../lib/identity-stack';

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: 'us-east-1',
};

const cognitoStack = new CognitoStack(app, 'MiniChatCognitoStack', { env });

const secretsStack = new SecretsStack(app, 'MiniChatSecretsStack', { env });

const identityStack = new IdentityStack(app, 'MiniChatIdentityStack', {
  env,
  cognitoStack,
  secretsStack,
});
identityStack.addDependency(cognitoStack);
identityStack.addDependency(secretsStack);
