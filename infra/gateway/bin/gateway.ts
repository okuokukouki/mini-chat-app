#!/usr/bin/env node
// CDK App エントリポイント。IamStack → GatewayStack の順にデプロイする。

import * as cdk from 'aws-cdk-lib';
import { IamStack } from '../lib/iam-stack';
import { GatewayStack } from '../lib/gateway-stack';

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
};

const iamStack = new IamStack(app, 'MiniChatIamStack', { env });

const gatewayStack = new GatewayStack(app, 'MiniChatGatewayStack', {
  env,
  iamStack,
});
gatewayStack.addDependency(iamStack);
