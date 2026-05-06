import { defineBackend } from "@aws-amplify/backend";
import { Stack } from "aws-cdk-lib";
import {
  CorsHttpMethod,
  HttpApi,
  HttpMethod,
  HttpNoneAuthorizer,
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

const congregationTable = new Table(storageStack, "CongregationTable", {
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

backend.congregationMessage.addEnvironment(
  "TEST_TABLE_NAME",
  congregationTable.tableName,
);
backend.congregationMessage.addEnvironment(
  "USER_POOL_ID",
  backend.auth.resources.userPool.userPoolId,
);
backend.congregationMessage.addEnvironment(
  "PARKING_NOTIFICATIONS_FROM_EMAIL",
  process.env.PARKING_NOTIFICATIONS_FROM_EMAIL ?? "",
);
backend.congregationMessage.addEnvironment(
  "GOOGLE_CLIENT_ID",
  process.env.GOOGLE_CLIENT_ID ?? "",
);
backend.congregationMessage.addEnvironment(
  "GOOGLE_CLIENT_SECRET",
  process.env.GOOGLE_CLIENT_SECRET ?? "",
);
backend.congregationMessage.addEnvironment(
  "GOOGLE_CALENDAR_CALLBACK_URL",
  process.env.GOOGLE_CALENDAR_CALLBACK_URL ?? "",
);
backend.congregationMessage.addEnvironment(
  "GOOGLE_TOKEN_ENCRYPTION_KEY",
  process.env.GOOGLE_TOKEN_ENCRYPTION_KEY ?? "",
);
congregationTable.grantReadWriteData(backend.congregationMessage.resources.lambda);
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
backend.congregationMessage.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    actions: ["ses:SendEmail", "ses:SendRawEmail"],
    resources: ["*"],
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
  path: "/congregation/directory",
  methods: [HttpMethod.GET],
  integration: new HttpLambdaIntegration(
    "CongregationDirectoryIntegration",
    backend.congregationMessage.resources.lambda,
  ),
});

congregationApi.addRoutes({
  path: "/calendar/google/connect/start",
  methods: [HttpMethod.POST],
  integration: new HttpLambdaIntegration(
    "GoogleCalendarConnectStartIntegration",
    backend.congregationMessage.resources.lambda,
  ),
});

congregationApi.addRoutes({
  path: "/calendar/google/connection",
  methods: [HttpMethod.GET],
  integration: new HttpLambdaIntegration(
    "GoogleCalendarConnectionIntegration",
    backend.congregationMessage.resources.lambda,
  ),
});

congregationApi.addRoutes({
  path: "/calendar/google/freebusy",
  methods: [HttpMethod.POST],
  integration: new HttpLambdaIntegration(
    "GoogleCalendarFreeBusyIntegration",
    backend.congregationMessage.resources.lambda,
  ),
});

congregationApi.addRoutes({
  path: "/calendar/google/calendars",
  methods: [HttpMethod.GET],
  integration: new HttpLambdaIntegration(
    "GoogleCalendarListIntegration",
    backend.congregationMessage.resources.lambda,
  ),
});

congregationApi.addRoutes({
  path: "/calendar/google/events",
  methods: [HttpMethod.POST],
  integration: new HttpLambdaIntegration(
    "GoogleCalendarEventsIntegration",
    backend.congregationMessage.resources.lambda,
  ),
});

congregationApi.addRoutes({
  path: "/calendar/google/events/all",
  methods: [HttpMethod.POST],
  integration: new HttpLambdaIntegration(
    "GoogleCalendarAllEventsIntegration",
    backend.congregationMessage.resources.lambda,
  ),
});

congregationApi.addRoutes({
  path: "/calendar/google/reporting",
  methods: [HttpMethod.POST],
  integration: new HttpLambdaIntegration(
    "GoogleCalendarReportingIntegration",
    backend.congregationMessage.resources.lambda,
  ),
});

congregationApi.addRoutes({
  path: "/calendar/google/events/create",
  methods: [HttpMethod.POST],
  integration: new HttpLambdaIntegration(
    "GoogleCalendarEventsCreateIntegration",
    backend.congregationMessage.resources.lambda,
  ),
});

congregationApi.addRoutes({
  path: "/calendar/google/events/update",
  methods: [HttpMethod.POST],
  integration: new HttpLambdaIntegration(
    "GoogleCalendarEventsUpdateIntegration",
    backend.congregationMessage.resources.lambda,
  ),
});

congregationApi.addRoutes({
  path: "/calendar/google/events/delete",
  methods: [HttpMethod.POST],
  integration: new HttpLambdaIntegration(
    "GoogleCalendarEventsDeleteIntegration",
    backend.congregationMessage.resources.lambda,
  ),
});

congregationApi.addRoutes({
  path: "/calendar/google/oauth/callback",
  methods: [HttpMethod.GET],
  authorizer: new HttpNoneAuthorizer(),
  integration: new HttpLambdaIntegration(
    "GoogleCalendarOauthCallbackIntegration",
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
  path: "/parking/registration",
  methods: [HttpMethod.POST],
  authorizer: new HttpNoneAuthorizer(),
  integration: new HttpLambdaIntegration(
    "ParkingRegistrationIntegration",
    backend.congregationMessage.resources.lambda,
  ),
});

congregationApi.addRoutes({
  path: "/parking/management",
  methods: [HttpMethod.GET, HttpMethod.POST],
  integration: new HttpLambdaIntegration(
    "ParkingManagementIntegration",
    backend.congregationMessage.resources.lambda,
  ),
});

congregationApi.addRoutes({
  path: "/parking/registrations",
  methods: [HttpMethod.GET],
  integration: new HttpLambdaIntegration(
    "ParkingRegistrationsIntegration",
    backend.congregationMessage.resources.lambda,
  ),
});

congregationApi.addRoutes({
  path: "/parking/registrations/status",
  methods: [HttpMethod.POST],
  integration: new HttpLambdaIntegration(
    "ParkingRegistrationsStatusIntegration",
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
        tableName: congregationTable.tableName,
        region: Stack.of(congregationTable).region,
      },
    },
  },
});
