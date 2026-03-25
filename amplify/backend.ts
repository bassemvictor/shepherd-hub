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
import {
  AwsCustomResource,
  AwsCustomResourcePolicy,
  PhysicalResourceId,
} from "aws-cdk-lib/custom-resources";

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
testTable.grantReadData(backend.congregationMessage.resources.lambda);

const seedItems = [
  {
    pk: { S: "CONGREGATION" },
    sk: { S: "MEMBER#1" },
    data: { S: "Elder coordination update" },
  },
  {
    pk: { S: "CONGREGATION" },
    sk: { S: "MEMBER#2" },
    data: { S: "Visitation follow-up scheduled" },
  },
];

seedItems.forEach((item, index) => {
  new AwsCustomResource(storageStack, `SeedTestTableItem${index + 1}`, {
    onCreate: {
      service: "DynamoDB",
      action: "putItem",
      parameters: {
        TableName: testTable.tableName,
        Item: item,
      },
      physicalResourceId: PhysicalResourceId.of(
        `test-table-seed-create-${index + 1}`,
      ),
    },
    onUpdate: {
      service: "DynamoDB",
      action: "putItem",
      parameters: {
        TableName: testTable.tableName,
        Item: item,
      },
      physicalResourceId: PhysicalResourceId.of(
        `test-table-seed-update-${index + 1}`,
      ),
    },
    policy: AwsCustomResourcePolicy.fromSdkCalls({
      resources: [testTable.tableArn],
    }),
  });
});

const congregationApi = new HttpApi(apiStack, "CongregationApi", {
  apiName: "congregationApi",
  corsPreflight: {
    allowOrigins: ["*"],
    allowHeaders: ["*"],
    allowMethods: [CorsHttpMethod.GET],
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
