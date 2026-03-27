import { defineBackend } from "@aws-amplify/backend";
import { Stack } from "aws-cdk-lib";
import {
  CorsHttpMethod,
  HttpApi,
  HttpMethod,
} from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import {
  AttributeType,
  BillingMode,
  Table,
} from "aws-cdk-lib/aws-dynamodb";

import { auth } from "./auth/resource.js";
import { congregationMessage } from "./functions/congregation-message/resource.js";

const backend = defineBackend({
  auth,
  congregationMessage,
});

const storageStack = backend.createStack("congregation-storage");
const apiStack = backend.createStack("congregation-api");

const testTable = new Table(storageStack, "TestTable", {
  tableName: "test_table",
  partitionKey: {
    name: "pk",
    type: AttributeType.STRING,
  },
  sortKey: {
    name: "sk",
    type: AttributeType.STRING,
  },
  billingMode: BillingMode.PAY_PER_REQUEST,
});

backend.congregationMessage.addEnvironment("TEST_TABLE_NAME", testTable.tableName);
testTable.grantReadWriteData(backend.congregationMessage.resources.lambda);

const congregationApi = new HttpApi(apiStack, "CongregationApi", {
  apiName: "congregationApi",
  corsPreflight: {
    allowOrigins: ["*"],
    allowHeaders: ["*"],
    allowMethods: [CorsHttpMethod.GET, CorsHttpMethod.POST],
  },
  createDefaultStage: true,
});

congregationApi.addRoutes({
  path: "/congregation/message",
  methods: [HttpMethod.GET],
  integration: new HttpLambdaIntegration(
    "CongregationMessageIntegration",
    backend.congregationMessage.resources.lambda,
  ),
});

congregationApi.addRoutes({
  path: "/congregation/member",
  methods: [HttpMethod.POST],
  integration: new HttpLambdaIntegration(
    "CongregationMemberIntegration",
    backend.congregationMessage.resources.lambda,
  ),
});

congregationApi.addRoutes({
  path: "/congregation/member/remove",
  methods: [HttpMethod.POST],
  integration: new HttpLambdaIntegration(
    "CongregationMemberRemoveIntegration",
    backend.congregationMessage.resources.lambda,
  ),
});

congregationApi.addRoutes({
  path: "/congregation/member/update",
  methods: [HttpMethod.POST],
  integration: new HttpLambdaIntegration(
    "CongregationMemberUpdateIntegration",
    backend.congregationMessage.resources.lambda,
  ),
});

backend.addOutput({
  custom: {
    API: {
      [congregationApi.httpApiName!]: {
        endpoint: congregationApi.url,
        region: Stack.of(congregationApi).region,
        apiName: congregationApi.httpApiName,
      },
    },
    storage: {
      testTable: {
        tableName: testTable.tableName,
        region: Stack.of(testTable).region,
      },
    },
  },
});
