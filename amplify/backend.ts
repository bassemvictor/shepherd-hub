import { defineBackend } from "@aws-amplify/backend";
import { Stack } from "aws-cdk-lib";
import {
  CorsHttpMethod,
  HttpApi,
  HttpMethod,
} from "aws-cdk-lib/aws-apigatewayv2";
import { HttpUserPoolAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import {
  AttributeType,
  BillingMode,
  Table,
} from "aws-cdk-lib/aws-dynamodb";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";

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
backend.congregationMessage.addEnvironment(
  "USER_POOL_ID",
  backend.auth.resources.userPool.userPoolId,
);
testTable.grantReadWriteData(backend.congregationMessage.resources.lambda);
backend.congregationMessage.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    actions: [
      "cognito-idp:ListUsers",
      "cognito-idp:AdminListGroupsForUser",
      "cognito-idp:AdminAddUserToGroup",
      "cognito-idp:AdminRemoveUserFromGroup",
    ],
    resources: [backend.auth.resources.userPool.userPoolArn],
  }),
);

const userPoolAuthorizer = new HttpUserPoolAuthorizer(
  "CongregationUserPoolAuthorizer",
  backend.auth.resources.userPool,
  {
    userPoolClients: [backend.auth.resources.userPoolClient],
  },
);

const congregationApi = new HttpApi(apiStack, "CongregationApi", {
  apiName: "congregationApi",
  corsPreflight: {
    allowOrigins: ["*"],
    allowHeaders: ["*"],
    allowMethods: [CorsHttpMethod.GET, CorsHttpMethod.POST],
  },
  createDefaultStage: true,
  defaultAuthorizer: userPoolAuthorizer,
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

congregationApi.addRoutes({
  path: "/congregation/member/visitation",
  methods: [HttpMethod.POST],
  integration: new HttpLambdaIntegration(
    "CongregationMemberVisitationIntegration",
    backend.congregationMessage.resources.lambda,
  ),
});

congregationApi.addRoutes({
  path: "/announcements",
  methods: [HttpMethod.GET],
  integration: new HttpLambdaIntegration(
    "AnnouncementsListIntegration",
    backend.congregationMessage.resources.lambda,
  ),
});

congregationApi.addRoutes({
  path: "/announcements/week",
  methods: [HttpMethod.POST],
  integration: new HttpLambdaIntegration(
    "AnnouncementsWeekIntegration",
    backend.congregationMessage.resources.lambda,
  ),
});

congregationApi.addRoutes({
  path: "/announcements/week/remove",
  methods: [HttpMethod.POST],
  integration: new HttpLambdaIntegration(
    "AnnouncementsWeekRemoveIntegration",
    backend.congregationMessage.resources.lambda,
  ),
});

congregationApi.addRoutes({
  path: "/contacts/import",
  methods: [HttpMethod.POST],
  integration: new HttpLambdaIntegration(
    "ContactsImportIntegration",
    backend.congregationMessage.resources.lambda,
  ),
});

congregationApi.addRoutes({
  path: "/admin/users",
  methods: [HttpMethod.GET],
  integration: new HttpLambdaIntegration(
    "AdminUsersListIntegration",
    backend.congregationMessage.resources.lambda,
  ),
});

congregationApi.addRoutes({
  path: "/admin/users/groups",
  methods: [HttpMethod.POST],
  integration: new HttpLambdaIntegration(
    "AdminUsersGroupsIntegration",
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
