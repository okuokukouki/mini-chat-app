// AgentCore Gateway + Lambda 関数 + Gateway Targets を 1 スタックに統合するスタック。

import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as bedrockagentcore from 'aws-cdk-lib/aws-bedrockagentcore';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import { IamStack } from './iam-stack';

interface GatewayStackProps extends cdk.StackProps {
  iamStack: IamStack;
}

export class GatewayStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: GatewayStackProps) {
    super(scope, id, props);

    const { iamStack } = props;

    // AgentCore Gateway（SigV4 IAM 認証）
    const gateway = new bedrockagentcore.CfnGateway(this, 'Gateway', {
      name: 'mini-chat-app-gateway',
      protocolType: 'MCP',
      authorizerType: 'AWS_IAM',
      roleArn: iamStack.gatewayRole.roleArn,
      protocolConfiguration: {
        mcp: {
          supportedVersions: ['2025-03-26'],
        },
      },
    });

    // Tavily Lambda 関数
    const tavilyFn = new lambda.Function(this, 'TavilyFunction', {
      functionName: 'mcp-tavily',
      runtime: lambda.Runtime.PYTHON_3_13,
      architecture: lambda.Architecture.ARM_64,
      handler: 'lambda_function.lambda_handler',
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../../../agentcore/lambda/tavily'),
        {
          bundling: {
            image: lambda.Runtime.PYTHON_3_13.bundlingImage,
            platform: 'linux/arm64',
            command: [
              'bash', '-c',
              'pip install -r requirements.txt -t /asset-output && cp lambda_function.py /asset-output/',
            ],
          },
        },
      ),
      memorySize: 1024,
      timeout: cdk.Duration.seconds(300),
      role: iamStack.lambdaRole,
      environment: {
        TAVILY_API_KEY_SECRET_NAME: iamStack.tavilySecret.secretName,
      },
    });

    // Gateway Target: tavily_search / tavily_extract
    new bedrockagentcore.CfnGatewayTarget(this, 'TavilySearchTarget', {
      gatewayIdentifier: gateway.attrGatewayIdentifier,
      name: 'tavily-search',
      // Gateway が Lambda を IAM ロール経由で呼び出すための設定
      credentialProviderConfigurations: [
        {
          credentialProviderType: 'GATEWAY_IAM_ROLE',
        },
      ],
      targetConfiguration: {
        mcp: {
          lambda: {
            lambdaArn: tavilyFn.functionArn,
            toolSchema: {
              inlinePayload: [
                {
                  name: 'tavily_search',
                  description: 'AI が精選した Web 検索を実行する。最新情報や一般的な調査に使用する。',
                  inputSchema: {
                    type: 'object',
                    properties: {
                      query: { type: 'string', description: '検索クエリ' },
                      search_depth: { type: 'string', description: '検索の深さ（basic: 標準, advanced: より詳細）' },
                      topic: { type: 'string', description: '検索トピック種別（general / news / research）' },
                    },
                    required: ['query'],
                  },
                },
                {
                  name: 'tavily_extract',
                  description: '指定した URL からコンテンツを抽出する。',
                  inputSchema: {
                    type: 'object',
                    properties: {
                      urls: { type: 'string', description: 'カンマ区切りの URL リスト' },
                      extract_depth: { type: 'string', description: '抽出の深さ（basic / advanced）' },
                    },
                    required: ['urls'],
                  },
                },
              ],
            },
          },
        },
      },
    });

    new cdk.CfnOutput(this, 'GatewayId', { value: gateway.attrGatewayIdentifier });
    new cdk.CfnOutput(this, 'GatewayUrl', {
      value: `https://${gateway.attrGatewayIdentifier}.gateway.bedrock-agentcore.${this.region}.amazonaws.com/mcp`,
      exportName: 'MiniChatGatewayUrl',
    });
  }
}