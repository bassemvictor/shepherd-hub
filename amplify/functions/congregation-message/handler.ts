import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";

type TableRow = {
  pk: string;
  sk: string;
  data: string;
};

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const handler: APIGatewayProxyHandlerV2 = async () => {
  const time = new Date().toISOString();
  const tableName = process.env.TEST_TABLE_NAME;

  if (!tableName) {
    return {
      statusCode: 500,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: "TEST_TABLE_NAME is not configured.",
        time,
        items: [],
      }),
    };
  }

  const response = await dynamoClient.send(
    new ScanCommand({
      TableName: tableName,
      Limit: 10,
    }),
  );
  const items = ((response.Items ?? []) as TableRow[]).sort((left, right) =>
    left.sk.localeCompare(right.sk),
  );

  return {
    statusCode: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: `Congregation API says hello. Current server time: ${time}`,
      time,
      items,
    }),
  };
};
