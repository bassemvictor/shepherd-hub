import { defineBackend } from "@aws-amplify/backend";
import { Stack } from "aws-cdk-lib";
import {
  CorsHttpMethod,
  HttpApi,
  HttpMethod,
} from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";

import { auth } from "./auth/resource.js";
import { congregationMessage } from "./functions/congregation-message/resource.js";

const backend = defineBackend({
  auth,
  congregationMessage,
});

const apiStack = backend.createStack("congregation-api");

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
  },
});
