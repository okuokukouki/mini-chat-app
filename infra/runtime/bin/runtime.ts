#!/usr/bin/env node
// CDK App エントリポイント。IamStack → RuntimeStack の順にデプロイする。

import * as cdk from 'aws-cdk-lib';
import { RuntimeStack } from '../lib/runtime-stack';

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: 'us-east-1',
};

new RuntimeStack(app, 'MiniChatRuntimeStack', { env });
