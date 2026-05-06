import assert from "node:assert/strict";
import { createCipheriv, randomBytes } from "node:crypto";
import { afterEach, beforeEach, test } from "node:test";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

import {
  handler,
  resetHandlerClientsForTesting,
  setHandlerClientsForTesting,
} from "../amplify/functions/congregation-message/handler.js";

type MockCommand = {
  constructor: { name: string };
  input?: Record<string, unknown>;
};

const parseBody = (body: string | undefined) => JSON.parse(body ?? "{}") as Record<string, unknown>;

const getExpectedSyncWindow = () => {
  const currentYear = new Date().getUTCFullYear();

  return {
    timeMin: new Date(Date.UTC(currentYear - 1, 0, 1, 0, 0, 0, 0)).toISOString(),
    timeMax: new Date(Date.UTC(currentYear + 3, 0, 1, 0, 0, 0, 0)).toISOString(),
  };
};

const encryptTestSecret = (value: string) => {
  const key = Buffer.from(process.env.GOOGLE_TOKEN_ENCRYPTION_KEY ?? "", "base64");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [iv, tag, encrypted].map((part) => part.toString("base64")).join(".");
};

const invokeHandler = async (event: APIGatewayProxyEventV2) =>
  (await handler(
    event,
    {} as never,
    (() => undefined) as never,
  )) as { statusCode: number; body?: string; headers?: Record<string, string> };

const createEvent = ({
  path,
  method = "GET",
  body,
  groups,
  email = "user@example.com",
  sub = "00000000-0000-4000-8000-000000000001",
  cognitoUsername = "user@example.com",
  headers,
  queryStringParameters,
}: {
  path: string;
  method?: "GET" | "POST";
  body?: Record<string, unknown>;
  groups?: string[];
  email?: string;
  sub?: string;
  cognitoUsername?: string;
  headers?: Record<string, string>;
  queryStringParameters?: Record<string, string>;
}) =>
  ({
    body: body ? JSON.stringify(body) : undefined,
    headers: headers ?? {},
    isBase64Encoded: false,
    rawPath: path,
    rawQueryString: queryStringParameters
      ? new URLSearchParams(queryStringParameters).toString()
      : "",
    queryStringParameters,
    requestContext: {
      accountId: "123456789012",
      apiId: "api-id",
      domainName: "example.com",
      domainPrefix: "example",
      http: {
        method,
        path,
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "node:test",
      },
      requestId: "request-id",
      routeKey: `${method} ${path}`,
      stage: "$default",
      time: "now",
      timeEpoch: Date.now(),
      authorizer: groups
        ? {
            jwt: {
              claims: {
                "cognito:groups": `[${groups.join(" ")}]`,
                email,
                sub,
                "cognito:username": cognitoUsername,
              },
            },
          }
        : undefined,
    },
    routeKey: `${method} ${path}`,
    version: "2.0",
  }) as APIGatewayProxyEventV2;

const createMockClient = (
  resolver: (command: MockCommand, index: number) => Promise<Record<string, unknown>> | Record<string, unknown>,
) => {
  const commands: MockCommand[] = [];

  return {
    commands,
    client: {
      send: async (command: unknown) => {
        const typedCommand = command as MockCommand;
        commands.push(typedCommand);
        return resolver(typedCommand, commands.length - 1);
      },
    },
  };
};

beforeEach(() => {
  process.env.TEST_TABLE_NAME = "test_table";
  process.env.USER_POOL_ID = "user-pool-id";
  process.env.PARKING_NOTIFICATIONS_FROM_EMAIL = "parking@example.com";
  process.env.GOOGLE_CLIENT_ID = "google-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "google-client-secret";
  process.env.GOOGLE_CALENDAR_CALLBACK_URL =
    "https://api.example.com/calendar/google/oauth/callback";
  process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  resetHandlerClientsForTesting();
});

afterEach(() => {
  resetHandlerClientsForTesting();
  delete process.env.TEST_TABLE_NAME;
  delete process.env.USER_POOL_ID;
  delete process.env.PARKING_NOTIFICATIONS_FROM_EMAIL;
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_CALENDAR_CALLBACK_URL;
  delete process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
});

test("returns 500 when TEST_TABLE_NAME is missing", async () => {
  delete process.env.TEST_TABLE_NAME;

  const response = await invokeHandler(createEvent({ path: "/congregation/message" }));
  const body = parseBody(response.body);

  assert.equal(response.statusCode, 500);
  assert.equal(body.message, "TEST_TABLE_NAME is not configured.");
});

test("forbids admin user listing for non-manager groups", async () => {
  const response = await invokeHandler(
    createEvent({ path: "/admin/users", groups: ["regular_user"] }),
  );
  const body = parseBody(response.body);

  assert.equal(response.statusCode, 403);
  assert.equal(body.message, "You do not have access to manage user groups.");
});

test("lists Cognito users and their groups for managers", async () => {
  const cognito = createMockClient((command) => {
    if (command.constructor.name === "ListUsersCommand") {
      return {
        Users: [
          {
            Username: "alice",
            Enabled: true,
            UserStatus: "CONFIRMED",
            Attributes: [{ Name: "email", Value: "alice@example.com" }],
          },
        ],
      };
    }

    if (command.constructor.name === "AdminListGroupsForUserCommand") {
      return {
        Groups: [{ GroupName: "admin" }, { GroupName: "regular_user" }],
      };
    }

    throw new Error(`Unexpected command ${command.constructor.name}`);
  });

  setHandlerClientsForTesting({ cognitoClient: cognito.client });

  const response = await invokeHandler(
    createEvent({ path: "/admin/users", groups: ["admin"] }),
  );
  const body = parseBody(response.body);

  assert.equal(response.statusCode, 200);
  assert.equal(body.message, "User directory loaded.");
  assert.deepEqual(body.groupOptions, ["admin", "super_user", "regular_user", "parking_admin"]);
  assert.deepEqual(body.items, [
    {
      username: "alice",
      email: "alice@example.com",
      enabled: true,
      status: "CONFIRMED",
      groups: ["admin", "regular_user"],
    },
  ]);
});

test("updates Cognito user groups", async () => {
  const cognito = createMockClient((command) => {
    if (command.constructor.name === "AdminListGroupsForUserCommand") {
      return {
        Groups: [{ GroupName: "regular_user" }],
      };
    }

    if (
      command.constructor.name === "AdminAddUserToGroupCommand" ||
      command.constructor.name === "AdminRemoveUserFromGroupCommand"
    ) {
      return {};
    }

    throw new Error(`Unexpected command ${command.constructor.name}`);
  });

  setHandlerClientsForTesting({ cognitoClient: cognito.client });

  const response = await invokeHandler(
    createEvent({
      path: "/admin/users/groups",
      method: "POST",
      groups: ["super_user"],
      body: {
        username: "alice",
        groups: ["admin"],
      },
    }),
  );
  const body = parseBody(response.body);

  assert.equal(response.statusCode, 200);
  assert.equal(body.message, "User groups updated.");
  assert.deepEqual(
    cognito.commands.map((command) => command.constructor.name),
    [
      "AdminListGroupsForUserCommand",
      "AdminAddUserToGroupCommand",
      "AdminRemoveUserFromGroupCommand",
    ],
  );
});

test("forbids announcement writes for regular users", async () => {
  const response = await invokeHandler(
    createEvent({
      path: "/announcements/week",
      method: "POST",
      groups: ["regular_user"],
      body: { weekLabel: "2026-W13", items: ["One"] },
    }),
  );
  const body = parseBody(response.body);

  assert.equal(response.statusCode, 403);
  assert.equal(body.message, "You do not have access to add or edit announcements.");
});

test("forbids contacts import for regular users", async () => {
  const response = await invokeHandler(
    createEvent({
      path: "/contacts/import",
      method: "POST",
      groups: ["regular_user"],
      body: {
        content: "BEGIN:VCARD\nFN:John Smith\nEND:VCARD",
      },
    }),
  );
  const body = parseBody(response.body);

  assert.equal(response.statusCode, 403);
  assert.equal(body.message, "You do not have access to import contacts.");
});

test("starts the Google Calendar OAuth flow for a signed-in user", async () => {
  const dynamo = createMockClient((command) => {
    if (command.constructor.name === "PutCommand") {
      return {};
    }

    throw new Error(`Unexpected command ${command.constructor.name}`);
  });

  setHandlerClientsForTesting({ dynamoClient: dynamo.client });

  const response = await invokeHandler(
    createEvent({
      path: "/calendar/google/connect/start",
      method: "POST",
      groups: ["admin"],
      body: {
        returnTo: "https://app.example.com/calendar/connect",
      },
    }),
  );
  const body = parseBody(response.body);

  assert.equal(response.statusCode, 200);
  assert.equal(body.message, "Google Calendar authorization started.");
  assert.match(String(body.authorizationUrl), /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/);
  assert.equal(dynamo.commands[0]?.constructor.name, "PutCommand");
});

test("loads an existing Google Calendar connection", async () => {
  const connectionData = {
    email: "user@example.com",
    refreshTokenEncrypted: "refresh.encrypted.value",
    accessTokenEncrypted: "access.encrypted.value",
    accessTokenExpiresAt: "2999-01-01T00:00:00.000Z",
    connectedAt: "2026-04-26T12:00:00.000Z",
    updatedAt: "2026-04-26T12:05:00.000Z",
    refreshTokenUpdatedAt: "2026-04-26T12:00:00.000Z",
    tokenScope: "https://www.googleapis.com/auth/calendar",
    tokenType: "Bearer",
    lastError: null,
  };
  const dynamo = createMockClient((command) => {
    if (command.constructor.name === "GetCommand") {
      return {
        Item: {
          pk: "CALENDAR_INTEGRATION",
          sk: "GOOGLE#user@example.com",
          data: JSON.stringify(connectionData),
        },
      };
    }

    throw new Error(`Unexpected command ${command.constructor.name}`);
  });

  setHandlerClientsForTesting({ dynamoClient: dynamo.client });

  const response = await invokeHandler(
    createEvent({
      path: "/calendar/google/connection",
      groups: ["admin"],
    }),
  );
  const body = parseBody(response.body);

  assert.equal(response.statusCode, 200);
  assert.equal(body.connected, true);
  assert.equal(body.hasRefreshToken, true);
  assert.equal(body.accessTokenExpiresAt, connectionData.accessTokenExpiresAt);
});

test("loads Google Calendar free/busy availability", async () => {
  const originalFetch = globalThis.fetch;
  const connectionData = {
    email: "user@example.com",
    refreshTokenEncrypted: encryptTestSecret("refresh-token"),
    accessTokenEncrypted: encryptTestSecret("access-token"),
    accessTokenExpiresAt: "2999-01-01T00:00:00.000Z",
    connectedAt: "2026-04-26T12:00:00.000Z",
    updatedAt: "2026-04-26T12:05:00.000Z",
    refreshTokenUpdatedAt: "2026-04-26T12:00:00.000Z",
    tokenScope: "https://www.googleapis.com/auth/calendar",
    tokenType: "Bearer",
    lastError: null,
  };
  const dynamo = createMockClient((command) => {
    if (command.constructor.name === "GetCommand") {
      return {
        Item: {
          pk: "CALENDAR_INTEGRATION",
          sk: "GOOGLE#user@example.com",
          data: JSON.stringify(connectionData),
        },
      };
    }

    throw new Error(`Unexpected command ${command.constructor.name}`);
  });

  globalThis.fetch = async (_input, init) =>
    ({
      ok: true,
      json: async () => ({
        timeMin: "2026-04-27T13:00:00.000Z",
        timeMax: "2026-04-27T21:00:00.000Z",
        calendars: {
          primary: {
            busy: [
              {
                start: "2026-04-27T15:00:00.000Z",
                end: "2026-04-27T16:00:00.000Z",
              },
            ],
          },
        },
      }),
    }) as Response;

  setHandlerClientsForTesting({ dynamoClient: dynamo.client });

  const response = await invokeHandler(
    createEvent({
      path: "/calendar/google/freebusy",
      method: "POST",
      groups: ["admin"],
      body: {
        timeMin: "2026-04-27T13:00:00.000Z",
        timeMax: "2026-04-27T21:00:00.000Z",
        timeZone: "America/Toronto",
        calendarId: "primary",
      },
    }),
  );
  const body = parseBody(response.body);

  globalThis.fetch = originalFetch;

  assert.equal(response.statusCode, 200);
  assert.equal(body.message, "Google Calendar availability loaded.");
  assert.deepEqual(body.busy, [
    {
      start: "2026-04-27T15:00:00.000Z",
      end: "2026-04-27T16:00:00.000Z",
    },
  ]);
});

test("loads Google calendar names", async () => {
  const originalFetch = globalThis.fetch;
  const connectionData = {
    email: "user@example.com",
    refreshTokenEncrypted: encryptTestSecret("refresh-token"),
    accessTokenEncrypted: encryptTestSecret("access-token"),
    accessTokenExpiresAt: "2999-01-01T00:00:00.000Z",
    connectedAt: "2026-04-26T12:00:00.000Z",
    updatedAt: "2026-04-26T12:05:00.000Z",
    refreshTokenUpdatedAt: "2026-04-26T12:00:00.000Z",
    tokenScope: "https://www.googleapis.com/auth/calendar",
    tokenType: "Bearer",
    lastError: null,
  };
  const dynamo = createMockClient((command) => {
    if (command.constructor.name === "GetCommand") {
      return {
        Item: {
          pk: "CALENDAR_INTEGRATION",
          sk: "GOOGLE#user@example.com",
          data: JSON.stringify(connectionData),
        },
      };
    }

    throw new Error(`Unexpected command ${command.constructor.name}`);
  });

  globalThis.fetch = async () =>
    ({
      ok: true,
      json: async () => ({
        items: [
          {
            id: "primary",
            summary: "My Calendar",
            primary: true,
            accessRole: "owner",
            timeZone: "America/Toronto",
          },
          {
            id: "team@example.com",
            summary: "Team Calendar",
            accessRole: "reader",
            timeZone: "America/Toronto",
          },
        ],
      }),
    }) as Response;

  setHandlerClientsForTesting({ dynamoClient: dynamo.client });

  const response = await invokeHandler(
    createEvent({
      path: "/calendar/google/calendars",
      groups: ["admin"],
    }),
  );
  const body = parseBody(response.body);

  globalThis.fetch = originalFetch;

  assert.equal(response.statusCode, 200);
  assert.equal(body.message, "Google calendars loaded.");
  assert.deepEqual(body.items, [
    {
      id: "primary",
      name: "My Calendar",
      primary: true,
      accessRole: "owner",
      timeZone: "America/Toronto",
      hidden: false,
      selected: false,
    },
    {
      id: "team@example.com",
      name: "Team Calendar",
      primary: false,
      accessRole: "reader",
      timeZone: "America/Toronto",
      hidden: false,
      selected: false,
    },
  ]);
});

test("loads Google calendar events", async () => {
  const originalFetch = globalThis.fetch;
  const connectionData = {
    email: "user@example.com",
    refreshTokenEncrypted: encryptTestSecret("refresh-token"),
    accessTokenEncrypted: encryptTestSecret("access-token"),
    accessTokenExpiresAt: "2999-01-01T00:00:00.000Z",
    connectedAt: "2026-04-26T12:00:00.000Z",
    updatedAt: "2026-04-26T12:05:00.000Z",
    refreshTokenUpdatedAt: "2026-04-26T12:00:00.000Z",
    tokenScope: "https://www.googleapis.com/auth/calendar",
    tokenType: "Bearer",
    lastError: null,
  };
  const dynamo = createMockClient((command) => {
    if (command.constructor.name === "GetCommand") {
      return {
        Item: {
          pk: "CALENDAR_INTEGRATION",
          sk: "GOOGLE#user@example.com",
          data: JSON.stringify(connectionData),
        },
      };
    }

    throw new Error(`Unexpected command ${command.constructor.name}`);
  });

  globalThis.fetch = async () =>
    ({
      ok: true,
      json: async () => ({
        items: [
          {
            id: "event-1",
            summary: "Staff Meeting",
            start: { dateTime: "2026-04-27T15:00:00.000Z" },
            end: { dateTime: "2026-04-27T16:00:00.000Z" },
            organizer: { displayName: "Admin" },
            location: "Main Hall",
            eventType: "default",
            visibility: "private",
            status: "confirmed",
          },
        ],
      }),
    }) as Response;

  setHandlerClientsForTesting({ dynamoClient: dynamo.client });

  const response = await invokeHandler(
    createEvent({
      path: "/calendar/google/events",
      method: "POST",
      groups: ["admin"],
      body: {
        timeMin: "2026-04-27T13:00:00.000Z",
        timeMax: "2026-04-27T21:00:00.000Z",
        timeZone: "America/Toronto",
        calendarId: "primary",
      },
    }),
  );
  const body = parseBody(response.body);

  globalThis.fetch = originalFetch;

  assert.equal(response.statusCode, 200);
  assert.equal(body.message, "Google Calendar events loaded.");
  assert.deepEqual(body.items, [
    {
      id: "event-1",
      title: "Staff Meeting",
      status: "confirmed",
      htmlLink: "",
      location: "Main Hall",
      description: "",
      eventType: "default",
      visibility: "private",
      start: "2026-04-27T15:00:00.000Z",
      end: "2026-04-27T16:00:00.000Z",
      isAllDay: false,
      organizer: "Admin",
      congregationItems: [],
    },
  ]);
});

test("loads Google calendar events from month-based sync cache", async () => {
  const originalFetch = globalThis.fetch;
  const syncWindow = getExpectedSyncWindow();
  const connectionData = {
    email: "user@example.com",
    refreshTokenEncrypted: encryptTestSecret("refresh-token"),
    accessTokenEncrypted: encryptTestSecret("access-token"),
    accessTokenExpiresAt: "2999-01-01T00:00:00.000Z",
    connectedAt: "2026-04-26T12:00:00.000Z",
    updatedAt: "2026-04-26T12:05:00.000Z",
    refreshTokenUpdatedAt: "2026-04-26T12:00:00.000Z",
    tokenScope: "https://www.googleapis.com/auth/calendar",
    tokenType: "Bearer",
    lastError: null,
  };
  const store = new Map<string, Record<string, unknown>>();
  const keyFor = (pk: string, sk: string) => `${pk}||${sk}`;
  const dynamo = createMockClient((command) => {
    if (command.constructor.name === "GetCommand") {
      const key = command.input?.Key as { pk: string; sk: string };

      if (key.pk === "CALENDAR_INTEGRATION") {
        return {
          Item: {
            pk: key.pk,
            sk: key.sk,
            data: JSON.stringify(connectionData),
          },
        };
      }

      return {
        Item: store.get(keyFor(key.pk, key.sk)),
      };
    }

    if (command.constructor.name === "PutCommand") {
      const item = command.input?.Item as Record<string, unknown>;
      store.set(keyFor(String(item.pk), String(item.sk)), item);
      return {};
    }

    if (command.constructor.name === "DeleteCommand") {
      const key = command.input?.Key as { pk: string; sk: string };
      store.delete(keyFor(key.pk, key.sk));
      return {};
    }

    if (command.constructor.name === "QueryCommand") {
      const values = command.input?.ExpressionAttributeValues as Record<string, string>;
      const pk = values?.[":pk"];

      return {
        Items: Array.from(store.values()).filter((item) => item.pk === pk),
      };
    }

    throw new Error(`Unexpected command ${command.constructor.name}`);
  });

  let requestedSyncUrl = "";
  globalThis.fetch = async (input) => {
    requestedSyncUrl = String(input);

    return ({
      ok: true,
      json: async () => ({
        items: [
          {
            id: "event-3",
            summary: "Month Cached Event",
            start: { dateTime: "2026-05-03T15:00:00.000Z" },
            end: { dateTime: "2026-05-03T16:00:00.000Z" },
            organizer: { displayName: "Admin" },
            location: "Office",
            eventType: "default",
            visibility: "default",
            status: "confirmed",
          },
        ],
        nextSyncToken: "sync-token-1",
      }),
    }) as Response;
  };

  setHandlerClientsForTesting({ dynamoClient: dynamo.client });

  const response = await invokeHandler(
    createEvent({
      path: "/calendar/google/events",
      method: "POST",
      groups: ["admin"],
      body: {
        timeMin: "2026-05-01T00:00:00.000Z",
        timeMax: "2026-06-01T00:00:00.000Z",
        timeZone: "America/Toronto",
        calendarId: "primary",
        useSyncCache: true,
      },
    }),
  );
  const body = parseBody(response.body);

  globalThis.fetch = originalFetch;

  assert.equal(response.statusCode, 200);
  assert.equal(body.syncMode, "full");
  assert.deepEqual(body.items, [
    {
      id: "event-3",
      title: "Month Cached Event",
      status: "confirmed",
      htmlLink: "",
      location: "Office",
      description: "",
      eventType: "default",
      visibility: "default",
      start: "2026-05-03T15:00:00.000Z",
      end: "2026-05-03T16:00:00.000Z",
      isAllDay: false,
      organizer: "Admin",
      congregationItems: [],
    },
  ]);

  const storedItems = Array.from(store.values());
  const syncStateItem = storedItems.find((item) => item.sk === "SYNC_STATE");
  assert.ok(syncStateItem);
  assert.deepEqual(JSON.parse(String(syncStateItem.data)), {
    syncToken: "sync-token-1",
    timeMin: syncWindow.timeMin,
    timeMax: syncWindow.timeMax,
  });
  assert.ok(
    storedItems.some((item) => String(item.sk).startsWith("MONTH#2026-05#")),
  );

  const syncRequest = new URL(requestedSyncUrl);
  assert.equal(syncRequest.searchParams.get("timeMin"), syncWindow.timeMin);
  assert.equal(syncRequest.searchParams.get("timeMax"), syncWindow.timeMax);
});

test("loads Google calendar events across all calendars with one API call", async () => {
  const originalFetch = globalThis.fetch;
  const connectionData = {
    email: "user@example.com",
    refreshTokenEncrypted: encryptTestSecret("refresh-token"),
    accessTokenEncrypted: encryptTestSecret("access-token"),
    accessTokenExpiresAt: "2999-01-01T00:00:00.000Z",
    connectedAt: "2026-04-26T12:00:00.000Z",
    updatedAt: "2026-04-26T12:05:00.000Z",
    refreshTokenUpdatedAt: "2026-04-26T12:00:00.000Z",
    tokenScope: "https://www.googleapis.com/auth/calendar",
    tokenType: "Bearer",
    lastError: null,
  };
  const store = new Map<string, Record<string, unknown>>();
  const keyFor = (pk: string, sk: string) => `${pk}||${sk}`;
  const dynamo = createMockClient((command) => {
    if (command.constructor.name === "GetCommand") {
      const key = command.input?.Key as { pk: string; sk: string };

      if (key.pk === "CALENDAR_INTEGRATION") {
        return {
          Item: {
            pk: key.pk,
            sk: key.sk,
            data: JSON.stringify(connectionData),
          },
        };
      }

      return {
        Item: store.get(keyFor(key.pk, key.sk)),
      };
    }

    if (command.constructor.name === "PutCommand") {
      const item = command.input?.Item as Record<string, unknown>;
      store.set(keyFor(String(item.pk), String(item.sk)), item);
      return {};
    }

    if (command.constructor.name === "DeleteCommand") {
      const key = command.input?.Key as { pk: string; sk: string };
      store.delete(keyFor(key.pk, key.sk));
      return {};
    }

    if (command.constructor.name === "QueryCommand") {
      const values = command.input?.ExpressionAttributeValues as Record<string, string>;
      const pk = values?.[":pk"];

      return {
        Items: Array.from(store.values()).filter((item) => item.pk === pk),
      };
    }

    throw new Error(`Unexpected command ${command.constructor.name}`);
  });

  globalThis.fetch = async (input) => {
    const url = String(input);

    if (url.includes("/calendar/v3/users/me/calendarList")) {
      return {
        ok: true,
        json: async () => ({
          items: [
            {
              id: "primary",
              summary: "Primary Calendar",
              primary: true,
              accessRole: "owner",
              timeZone: "America/Toronto",
              hidden: false,
              selected: true,
            },
            {
              id: "team",
              summary: "Team Calendar",
              accessRole: "reader",
              timeZone: "America/Toronto",
              hidden: false,
              selected: true,
            },
          ],
        }),
      } as Response;
    }

    if (url.includes("/calendar/v3/calendars/primary/events")) {
      return {
        ok: true,
        json: async () => ({
          items: [
            {
              id: "event-primary",
              summary: "Primary Event",
              start: { dateTime: "2026-05-03T15:00:00.000Z" },
              end: { dateTime: "2026-05-03T16:00:00.000Z" },
              organizer: { displayName: "Admin" },
              eventType: "default",
              visibility: "default",
              status: "confirmed",
            },
          ],
          nextSyncToken: "sync-token-primary",
        }),
      } as Response;
    }

    if (url.includes("/calendar/v3/calendars/team/events")) {
      return {
        ok: true,
        json: async () => ({
          items: [
            {
              id: "event-team",
              summary: "Team Event",
              start: { dateTime: "2026-05-04T15:00:00.000Z" },
              end: { dateTime: "2026-05-04T16:00:00.000Z" },
              organizer: { displayName: "Team Admin" },
              eventType: "default",
              visibility: "default",
              status: "confirmed",
            },
          ],
          nextSyncToken: "sync-token-team",
        }),
      } as Response;
    }

    throw new Error(`Unexpected fetch call for ${url}`);
  };

  setHandlerClientsForTesting({ dynamoClient: dynamo.client });

  const response = await invokeHandler(
    createEvent({
      path: "/calendar/google/events/all",
      method: "POST",
      groups: ["admin"],
      body: {
        timeMin: "2026-05-01T00:00:00.000Z",
        timeMax: "2026-06-01T00:00:00.000Z",
        timeZone: "America/Toronto",
        useSyncCache: true,
      },
    }),
  );
  const body = parseBody(response.body);

  globalThis.fetch = originalFetch;

  assert.equal(response.statusCode, 200);
  assert.equal(body.calendarId, "all");
  assert.equal(body.syncMode, "full");
  assert.equal(Array.isArray(body.calendars) ? body.calendars.length : 0, 2);
  assert.equal(Array.isArray(body.items) ? body.items.length : 2, 2);
  assert.ok(
    Array.isArray(body.items) &&
      body.items.some((item) => item.calendarId === "primary" && item.calendarName === "Primary Calendar"),
  );
  assert.ok(
    Array.isArray(body.items) &&
      body.items.some((item) => item.calendarId === "team" && item.calendarName === "Team Calendar"),
  );
});

test("stores cross-month Google calendar events in each overlapping month and dedupes reads", async () => {
  const originalFetch = globalThis.fetch;
  const connectionData = {
    email: "user@example.com",
    refreshTokenEncrypted: encryptTestSecret("refresh-token"),
    accessTokenEncrypted: encryptTestSecret("access-token"),
    accessTokenExpiresAt: "2999-01-01T00:00:00.000Z",
    connectedAt: "2026-04-26T12:00:00.000Z",
    updatedAt: "2026-04-26T12:05:00.000Z",
    refreshTokenUpdatedAt: "2026-04-26T12:00:00.000Z",
    tokenScope: "https://www.googleapis.com/auth/calendar",
    tokenType: "Bearer",
    lastError: null,
  };
  const store = new Map<string, Record<string, unknown>>();
  const keyFor = (pk: string, sk: string) => `${pk}||${sk}`;
  const dynamo = createMockClient((command) => {
    if (command.constructor.name === "GetCommand") {
      const key = command.input?.Key as { pk: string; sk: string };

      if (key.pk === "CALENDAR_INTEGRATION") {
        return {
          Item: {
            pk: key.pk,
            sk: key.sk,
            data: JSON.stringify(connectionData),
          },
        };
      }

      return {
        Item: store.get(keyFor(key.pk, key.sk)),
      };
    }

    if (command.constructor.name === "PutCommand") {
      const item = command.input?.Item as Record<string, unknown>;
      store.set(keyFor(String(item.pk), String(item.sk)), item);
      return {};
    }

    if (command.constructor.name === "DeleteCommand") {
      const key = command.input?.Key as { pk: string; sk: string };
      store.delete(keyFor(key.pk, key.sk));
      return {};
    }

    if (command.constructor.name === "QueryCommand") {
      const values = command.input?.ExpressionAttributeValues as Record<string, string>;
      const pk = values?.[":pk"];
      const skPrefix = values?.[":skPrefix"];
      const items = Array.from(store.values()).filter((item) => item.pk === pk);

      return {
        Items: skPrefix
          ? items.filter((item) => String(item.sk).startsWith(skPrefix))
          : items,
      };
    }

    throw new Error(`Unexpected command ${command.constructor.name}`);
  });

  globalThis.fetch = async () =>
    ({
      ok: true,
      json: async () => ({
        items: [
          {
            id: "event-cross-month",
            summary: "Cross Month Event",
            start: { dateTime: "2026-05-31T23:00:00.000Z" },
            end: { dateTime: "2026-06-01T01:00:00.000Z" },
            organizer: { displayName: "Admin" },
            location: "Main Hall",
            eventType: "default",
            visibility: "default",
            status: "confirmed",
          },
        ],
        nextSyncToken: "sync-token-cross-month",
      }),
    }) as Response;

  setHandlerClientsForTesting({ dynamoClient: dynamo.client });

  const syncResponse = await invokeHandler(
    createEvent({
      path: "/calendar/google/events",
      method: "POST",
      groups: ["admin"],
      body: {
        timeMin: "2026-05-01T00:00:00.000Z",
        timeMax: "2026-06-30T00:00:00.000Z",
        timeZone: "America/Toronto",
        calendarId: "primary",
        useSyncCache: true,
      },
    }),
  );
  const syncBody = parseBody(syncResponse.body);

  assert.equal(syncResponse.statusCode, 200);
  assert.equal(syncBody.syncMode, "full");

  const storedItems = Array.from(store.values());
  const mayRow = storedItems.find((item) => String(item.sk).startsWith("MONTH#2026-05#"));
  const juneRow = storedItems.find((item) => String(item.sk).startsWith("MONTH#2026-06#"));

  assert.ok(mayRow);
  assert.ok(juneRow);

  globalThis.fetch = async () => {
    throw new Error("Fetch should not be called for cache-only month reads.");
  };

  const juneResponse = await invokeHandler(
    createEvent({
      path: "/calendar/google/events",
      method: "POST",
      groups: ["admin"],
      body: {
        timeMin: "2026-06-01T00:00:00.000Z",
        timeMax: "2026-07-01T00:00:00.000Z",
        timeZone: "America/Toronto",
        calendarId: "primary",
        useSyncCache: true,
        cacheOnly: true,
        selectedYearMonth: "2026-06",
        viewMode: "month",
      },
    }),
  );
  const juneBody = parseBody(juneResponse.body);

  const rangeResponse = await invokeHandler(
    createEvent({
      path: "/calendar/google/events",
      method: "POST",
      groups: ["admin"],
      body: {
        timeMin: "2026-05-30T00:00:00.000Z",
        timeMax: "2026-06-02T00:00:00.000Z",
        timeZone: "America/Toronto",
        calendarId: "primary",
        useSyncCache: true,
        cacheOnly: true,
        selectedPeriodMonths: ["2026-05", "2026-06"],
        viewMode: "week",
      },
    }),
  );
  const rangeBody = parseBody(rangeResponse.body);

  globalThis.fetch = originalFetch;

  assert.equal(juneResponse.statusCode, 200);
  assert.equal(juneBody.syncMode, "cached");
  assert.deepEqual(juneBody.items, [
    {
      id: "event-cross-month",
      title: "Cross Month Event",
      status: "confirmed",
      htmlLink: "",
      location: "Main Hall",
      description: "",
      eventType: "default",
      visibility: "default",
      start: "2026-05-31T23:00:00.000Z",
      end: "2026-06-01T01:00:00.000Z",
      isAllDay: false,
      organizer: "Admin",
      congregationItems: [],
    },
  ]);
  assert.equal(rangeResponse.statusCode, 200);
  assert.equal(rangeBody.syncMode, "cached");
  assert.equal(Array.isArray(rangeBody.items) ? rangeBody.items.length : 0, 1);
});

test("loads Google calendar reporting rows from cached event metadata", async () => {
  const originalFetch = globalThis.fetch;
  const connectionData = {
    email: "user@example.com",
    refreshTokenEncrypted: encryptTestSecret("refresh-token"),
    accessTokenEncrypted: encryptTestSecret("access-token"),
    accessTokenExpiresAt: "2999-01-01T00:00:00.000Z",
    connectedAt: "2026-04-26T12:00:00.000Z",
    updatedAt: "2026-04-26T12:05:00.000Z",
    refreshTokenUpdatedAt: "2026-04-26T12:00:00.000Z",
    tokenScope: "https://www.googleapis.com/auth/calendar",
    tokenType: "Bearer",
    lastError: null,
  };
  const dynamo = createMockClient((command) => {
    if (command.constructor.name === "GetCommand") {
      return {
        Item: {
          pk: "CALENDAR_INTEGRATION",
          sk: "GOOGLE#00000000-0000-4000-8000-000000000001",
          data: JSON.stringify(connectionData),
        },
      };
    }

    if (command.constructor.name === "QueryCommand") {
      const values = command.input?.ExpressionAttributeValues as Record<string, string>;

      if (values?.[":pk"] === "CONGREGATION") {
        return {
          Items: [
            {
              pk: "CONGREGATION",
              sk: "MEMBER#1",
              data: JSON.stringify({
                firstName: "Mary",
                lastName: "Alpha",
                phone: "1111111111",
              }),
            },
            {
              pk: "CONGREGATION",
              sk: "MEMBER#2",
              data: JSON.stringify({
                firstName: "John",
                lastName: "Beta",
                phone: "2222222222",
              }),
            },
          ],
        };
      }

      if (values?.[":pk"] === "CALENDAR_EVENT_SYNC#00000000-0000-4000-8000-000000000001#primary") {
        return {
          Items: [
            {
              pk: values[":pk"],
              sk: "MONTH#2026-05#001",
              data: JSON.stringify({
                month: "2026-05",
                items: [
                  {
                    id: "event-1",
                    title: "Visit A",
                    status: "confirmed",
                    htmlLink: "",
                    location: "",
                    description: "",
                    eventType: "default",
                    visibility: "default",
                    start: "2026-05-03T15:00:00.000Z",
                    end: "2026-05-03T16:00:00.000Z",
                    isAllDay: false,
                    organizer: "Admin",
                    congregationItems: [
                      {
                        pk: "CONGREGATION",
                        sk: "MEMBER#1",
                        firstName: "Mary",
                        lastName: "Alpha",
                        phone: "1111111111",
                      },
                    ],
                  },
                  {
                    id: "event-2",
                    title: "Visit B",
                    status: "confirmed",
                    htmlLink: "",
                    location: "",
                    description: "",
                    eventType: "default",
                    visibility: "default",
                    start: "2026-05-06T15:00:00.000Z",
                    end: "2026-05-06T16:00:00.000Z",
                    isAllDay: false,
                    organizer: "Admin",
                    congregationItems: [
                      {
                        pk: "CONGREGATION",
                        sk: "MEMBER#1",
                        firstName: "Mary",
                        lastName: "Alpha",
                        phone: "1111111111",
                      },
                      {
                        pk: "CONGREGATION",
                        sk: "MEMBER#2",
                        firstName: "John",
                        lastName: "Beta",
                        phone: "2222222222",
                      },
                    ],
                  },
                ],
              }),
            },
          ],
        };
      }

      return {
        Items: [],
      };
    }

    throw new Error(`Unexpected command ${command.constructor.name}`);
  });

  globalThis.fetch = async () => {
    throw new Error("Fetch should not be called for cache-only reporting.");
  };

  setHandlerClientsForTesting({ dynamoClient: dynamo.client });

  const response = await invokeHandler(
    createEvent({
      path: "/calendar/google/reporting",
      method: "POST",
      groups: ["admin"],
      body: {
        year: 2026,
        calendarIds: ["primary"],
        cacheOnly: true,
      },
    }),
  );
  const body = parseBody(response.body);

  globalThis.fetch = originalFetch;

  assert.equal(response.statusCode, 200);
  assert.equal(body.syncMode, "cached");
  assert.equal(body.eventCount, 2);
  assert.deepEqual(body.rows, [
    {
      pk: "CONGREGATION",
      sk: "MEMBER#2",
      memberName: "John Beta",
      eventCountThisYear: 1,
      lastEventDate: "2026-05-06T15:00:00.000Z",
    },
    {
      pk: "CONGREGATION",
      sk: "MEMBER#1",
      memberName: "Mary Alpha",
      eventCountThisYear: 2,
      lastEventDate: "2026-05-06T15:00:00.000Z",
    },
  ]);
});

test("keeps cached Google calendar events visible when incremental sync returns no changes", async () => {
  const originalFetch = globalThis.fetch;
  const syncWindow = getExpectedSyncWindow();
  const connectionData = {
    email: "user@example.com",
    refreshTokenEncrypted: encryptTestSecret("refresh-token"),
    accessTokenEncrypted: encryptTestSecret("access-token"),
    accessTokenExpiresAt: "2999-01-01T00:00:00.000Z",
    connectedAt: "2026-04-26T12:00:00.000Z",
    updatedAt: "2026-04-26T12:05:00.000Z",
    refreshTokenUpdatedAt: "2026-04-26T12:00:00.000Z",
    tokenScope: "https://www.googleapis.com/auth/calendar",
    tokenType: "Bearer",
    lastError: null,
  };
  const store = new Map<string, Record<string, unknown>>();
  const keyFor = (pk: string, sk: string) => `${pk}||${sk}`;
  const syncPk =
    "CALENDAR_EVENT_SYNC#00000000-0000-4000-8000-000000000001#primary";

  store.set(keyFor(syncPk, "SYNC_STATE"), {
    pk: syncPk,
    sk: "SYNC_STATE",
    data: JSON.stringify({
      syncToken: "sync-token-existing",
      timeMin: syncWindow.timeMin,
      timeMax: syncWindow.timeMax,
    }),
  });
  store.set(keyFor(syncPk, "MONTH#2026-05#001"), {
    pk: syncPk,
    sk: "MONTH#2026-05#001",
    data: JSON.stringify({
      month: "2026-05",
      items: [
        {
          id: "event-existing",
          title: "Already Cached",
          status: "confirmed",
          htmlLink: "",
          location: "Office",
          description: "",
          eventType: "default",
          visibility: "default",
          start: "2026-05-03T15:00:00.000Z",
          end: "2026-05-03T16:00:00.000Z",
          isAllDay: false,
          organizer: "Admin",
          congregationItems: [],
        },
      ],
    }),
  });

  const dynamo = createMockClient((command) => {
    if (command.constructor.name === "GetCommand") {
      const key = command.input?.Key as { pk: string; sk: string };

      if (key.pk === "CALENDAR_INTEGRATION") {
        return {
          Item: {
            pk: key.pk,
            sk: key.sk,
            data: JSON.stringify(connectionData),
          },
        };
      }

      return {
        Item: store.get(keyFor(key.pk, key.sk)),
      };
    }

    if (command.constructor.name === "PutCommand") {
      const item = command.input?.Item as Record<string, unknown>;
      store.set(keyFor(String(item.pk), String(item.sk)), item);
      return {};
    }

    if (command.constructor.name === "DeleteCommand") {
      const key = command.input?.Key as { pk: string; sk: string };
      store.delete(keyFor(key.pk, key.sk));
      return {};
    }

    if (command.constructor.name === "QueryCommand") {
      const values = command.input?.ExpressionAttributeValues as Record<string, string>;
      const pk = values?.[":pk"];

      return {
        Items: Array.from(store.values()).filter((item) => item.pk === pk),
      };
    }

    throw new Error(`Unexpected command ${command.constructor.name}`);
  });

  let requestedIncrementalSyncUrl = "";
  globalThis.fetch = async (input) => {
    requestedIncrementalSyncUrl = String(input);

    return ({
      ok: true,
      json: async () => ({
        items: [],
        nextSyncToken: "sync-token-next",
      }),
    }) as Response;
  };

  setHandlerClientsForTesting({ dynamoClient: dynamo.client });

  const response = await invokeHandler(
    createEvent({
      path: "/calendar/google/events",
      method: "POST",
      groups: ["admin"],
      body: {
        timeMin: "2026-05-01T00:00:00.000Z",
        timeMax: "2026-06-01T00:00:00.000Z",
        timeZone: "America/Toronto",
        calendarId: "primary",
        useSyncCache: true,
      },
    }),
  );
  const body = parseBody(response.body);

  globalThis.fetch = originalFetch;

  assert.equal(response.statusCode, 200);
  assert.equal(body.syncMode, "incremental");
  assert.deepEqual(body.items, [
    {
      id: "event-existing",
      title: "Already Cached",
      status: "confirmed",
      htmlLink: "",
      location: "Office",
      description: "",
      eventType: "default",
      visibility: "default",
      start: "2026-05-03T15:00:00.000Z",
      end: "2026-05-03T16:00:00.000Z",
      isAllDay: false,
      organizer: "Admin",
      congregationItems: [],
    },
  ]);

  const incrementalSyncRequest = new URL(requestedIncrementalSyncUrl);
  assert.equal(incrementalSyncRequest.searchParams.get("syncToken"), "sync-token-existing");
  assert.equal(incrementalSyncRequest.searchParams.get("timeMin"), null);
  assert.equal(incrementalSyncRequest.searchParams.get("timeMax"), null);
});

test("resets legacy Google calendar sync cache when the rolling sync window changes", async () => {
  const originalFetch = globalThis.fetch;
  const syncWindow = getExpectedSyncWindow();
  const currentYear = new Date().getUTCFullYear();
  const connectionData = {
    email: "user@example.com",
    refreshTokenEncrypted: encryptTestSecret("refresh-token"),
    accessTokenEncrypted: encryptTestSecret("access-token"),
    accessTokenExpiresAt: "2999-01-01T00:00:00.000Z",
    connectedAt: "2026-04-26T12:00:00.000Z",
    updatedAt: "2026-04-26T12:05:00.000Z",
    refreshTokenUpdatedAt: "2026-04-26T12:00:00.000Z",
    tokenScope: "https://www.googleapis.com/auth/calendar",
    tokenType: "Bearer",
    lastError: null,
  };
  const store = new Map<string, Record<string, unknown>>();
  const keyFor = (pk: string, sk: string) => `${pk}||${sk}`;
  const syncPk =
    "CALENDAR_EVENT_SYNC#00000000-0000-4000-8000-000000000001#primary";
  const staleMonth = `${currentYear + 5}-01`;

  store.set(keyFor(syncPk, "SYNC_STATE"), {
    pk: syncPk,
    sk: "SYNC_STATE",
    data: JSON.stringify({
      syncToken: "legacy-sync-token",
    }),
  });
  store.set(keyFor(syncPk, `MONTH#${staleMonth}#001`), {
    pk: syncPk,
    sk: `MONTH#${staleMonth}#001`,
    data: JSON.stringify({
      month: staleMonth,
      items: [
        {
          id: "event-stale",
          title: "Stale Cached Event",
          status: "confirmed",
          htmlLink: "",
          location: "",
          description: "",
          eventType: "default",
          visibility: "default",
          start: `${staleMonth}-05T15:00:00.000Z`,
          end: `${staleMonth}-05T16:00:00.000Z`,
          isAllDay: false,
          organizer: "Admin",
          congregationItems: [],
        },
      ],
    }),
  });

  const dynamo = createMockClient((command) => {
    if (command.constructor.name === "GetCommand") {
      const key = command.input?.Key as { pk: string; sk: string };

      if (key.pk === "CALENDAR_INTEGRATION") {
        return {
          Item: {
            pk: key.pk,
            sk: key.sk,
            data: JSON.stringify(connectionData),
          },
        };
      }

      return {
        Item: store.get(keyFor(key.pk, key.sk)),
      };
    }

    if (command.constructor.name === "PutCommand") {
      const item = command.input?.Item as Record<string, unknown>;
      store.set(keyFor(String(item.pk), String(item.sk)), item);
      return {};
    }

    if (command.constructor.name === "DeleteCommand") {
      const key = command.input?.Key as { pk: string; sk: string };
      store.delete(keyFor(key.pk, key.sk));
      return {};
    }

    if (command.constructor.name === "QueryCommand") {
      const values = command.input?.ExpressionAttributeValues as Record<string, string>;
      const pk = values?.[":pk"];

      return {
        Items: Array.from(store.values()).filter((item) => item.pk === pk),
      };
    }

    throw new Error(`Unexpected command ${command.constructor.name}`);
  });

  globalThis.fetch = async () =>
    ({
      ok: true,
      json: async () => ({
        items: [
          {
            id: "event-current",
            summary: "Current Window Event",
            start: { dateTime: `${currentYear}-05-03T15:00:00.000Z` },
            end: { dateTime: `${currentYear}-05-03T16:00:00.000Z` },
            organizer: { displayName: "Admin" },
            eventType: "default",
            visibility: "default",
            status: "confirmed",
          },
        ],
        nextSyncToken: "sync-token-reset",
      }),
    }) as Response;

  setHandlerClientsForTesting({ dynamoClient: dynamo.client });

  const response = await invokeHandler(
    createEvent({
      path: "/calendar/google/events",
      method: "POST",
      groups: ["admin"],
      body: {
        timeMin: `${currentYear}-05-01T00:00:00.000Z`,
        timeMax: `${currentYear}-06-01T00:00:00.000Z`,
        timeZone: "America/Toronto",
        calendarId: "primary",
        useSyncCache: true,
      },
    }),
  );
  const body = parseBody(response.body);

  globalThis.fetch = originalFetch;

  assert.equal(response.statusCode, 200);
  assert.equal(body.syncMode, "full");
  assert.deepEqual(body.items, [
    {
      id: "event-current",
      title: "Current Window Event",
      status: "confirmed",
      htmlLink: "",
      location: "",
      description: "",
      eventType: "default",
      visibility: "default",
      start: `${currentYear}-05-03T15:00:00.000Z`,
      end: `${currentYear}-05-03T16:00:00.000Z`,
      isAllDay: false,
      organizer: "Admin",
      congregationItems: [],
    },
  ]);

  const storedItems = Array.from(store.values());
  assert.ok(!storedItems.some((item) => item.sk === `MONTH#${staleMonth}#001`));
  const syncStateItem = storedItems.find((item) => item.sk === "SYNC_STATE");
  assert.ok(syncStateItem);
  assert.deepEqual(JSON.parse(String(syncStateItem.data)), {
    syncToken: "sync-token-reset",
    timeMin: syncWindow.timeMin,
    timeMax: syncWindow.timeMax,
  });
});

test("falls back to direct Google calendar events when sync cache loading fails", async () => {
  const originalFetch = globalThis.fetch;
  const connectionData = {
    email: "user@example.com",
    refreshTokenEncrypted: encryptTestSecret("refresh-token"),
    accessTokenEncrypted: encryptTestSecret("access-token"),
    accessTokenExpiresAt: "2999-01-01T00:00:00.000Z",
    connectedAt: "2026-04-26T12:00:00.000Z",
    updatedAt: "2026-04-26T12:05:00.000Z",
    refreshTokenUpdatedAt: "2026-04-26T12:00:00.000Z",
    tokenScope: "https://www.googleapis.com/auth/calendar",
    tokenType: "Bearer",
    lastError: null,
  };
  const dynamo = createMockClient((command) => {
    if (command.constructor.name === "GetCommand") {
      return {
        Item: {
          pk: "CALENDAR_INTEGRATION",
          sk: "GOOGLE#00000000-0000-4000-8000-000000000001",
          data: JSON.stringify(connectionData),
        },
      };
    }

    if (command.constructor.name === "QueryCommand") {
      throw new Error("Sync cache query failed.");
    }

    throw new Error(`Unexpected command ${command.constructor.name}`);
  });

  globalThis.fetch = async (input) => {
    const url = String(input);

    if (url.includes("/calendar/v3/calendars/") && url.includes("/events")) {
      return {
        ok: true,
        json: async () => ({
          items: [
            {
              id: "event-2",
              summary: "Fallback Event",
              start: { dateTime: "2026-05-01T15:00:00.000Z" },
              end: { dateTime: "2026-05-01T16:00:00.000Z" },
              organizer: { displayName: "Admin" },
              location: "Library",
              eventType: "default",
              visibility: "default",
              status: "confirmed",
            },
          ],
        }),
      } as Response;
    }

    throw new Error(`Unexpected fetch call for ${url}`);
  };

  setHandlerClientsForTesting({ dynamoClient: dynamo.client });

  const response = await invokeHandler(
    createEvent({
      path: "/calendar/google/events",
      method: "POST",
      groups: ["admin"],
      body: {
        timeMin: "2026-05-01T00:00:00.000Z",
        timeMax: "2026-06-01T00:00:00.000Z",
        timeZone: "America/Toronto",
        calendarId: "primary",
        useSyncCache: true,
      },
    }),
  );
  const body = parseBody(response.body);

  globalThis.fetch = originalFetch;

  assert.equal(response.statusCode, 200);
  assert.equal(body.syncMode, "direct");
  assert.deepEqual(body.items, [
    {
      id: "event-2",
      title: "Fallback Event",
      status: "confirmed",
      htmlLink: "",
      location: "Library",
      description: "",
      eventType: "default",
      visibility: "default",
      start: "2026-05-01T15:00:00.000Z",
      end: "2026-05-01T16:00:00.000Z",
      isAllDay: false,
      organizer: "Admin",
      congregationItems: [],
    },
  ]);
});

test("stores direct Google calendar fallback events in DynamoDB cache", async () => {
  const originalFetch = globalThis.fetch;
  const connectionData = {
    email: "user@example.com",
    refreshTokenEncrypted: encryptTestSecret("refresh-token"),
    accessTokenEncrypted: encryptTestSecret("access-token"),
    accessTokenExpiresAt: "2999-01-01T00:00:00.000Z",
    connectedAt: "2026-04-26T12:00:00.000Z",
    updatedAt: "2026-04-26T12:05:00.000Z",
    refreshTokenUpdatedAt: "2026-04-26T12:00:00.000Z",
    tokenScope: "https://www.googleapis.com/auth/calendar",
    tokenType: "Bearer",
    lastError: null,
  };
  const store = new Map<string, Record<string, unknown>>();
  const keyFor = (pk: string, sk: string) => `${pk}||${sk}`;
  const syncPk =
    "CALENDAR_EVENT_SYNC#00000000-0000-4000-8000-000000000001#primary";
  const dynamo = createMockClient((command) => {
    if (command.constructor.name === "GetCommand") {
      const key = command.input?.Key as { pk: string; sk: string };

      if (key.pk === "CALENDAR_INTEGRATION") {
        return {
          Item: {
            pk: key.pk,
            sk: key.sk,
            data: JSON.stringify(connectionData),
          },
        };
      }

      return {
        Item: store.get(keyFor(key.pk, key.sk)),
      };
    }

    if (command.constructor.name === "PutCommand") {
      const item = command.input?.Item as Record<string, unknown>;
      store.set(keyFor(String(item.pk), String(item.sk)), item);
      return {};
    }

    if (command.constructor.name === "DeleteCommand") {
      const key = command.input?.Key as { pk: string; sk: string };
      store.delete(keyFor(key.pk, key.sk));
      return {};
    }

    if (command.constructor.name === "QueryCommand") {
      const values = command.input?.ExpressionAttributeValues as Record<string, string>;
      const pk = values?.[":pk"];

      return {
        Items: Array.from(store.values()).filter((item) => item.pk === pk),
      };
    }

    throw new Error(`Unexpected command ${command.constructor.name}`);
  });

  globalThis.fetch = async (input) => {
    const url = String(input);

    if (url.includes("showDeleted=true")) {
      return {
        ok: false,
        status: 500,
        json: async () => ({
          error: {
            message: "Sync path failed.",
          },
        }),
      } as Response;
    }

    if (url.includes("/calendar/v3/calendars/") && url.includes("/events")) {
      return {
        ok: true,
        json: async () => ({
          items: [
            {
              id: "event-direct-cache",
              summary: "Direct Cached Event",
              start: { dateTime: "2026-05-07T15:00:00.000Z" },
              end: { dateTime: "2026-05-07T16:00:00.000Z" },
              organizer: { displayName: "Admin" },
              location: "Office",
              eventType: "default",
              visibility: "default",
              status: "confirmed",
            },
          ],
        }),
      } as Response;
    }

    throw new Error(`Unexpected fetch call for ${url}`);
  };

  setHandlerClientsForTesting({ dynamoClient: dynamo.client });

  const response = await invokeHandler(
    createEvent({
      path: "/calendar/google/events",
      method: "POST",
      groups: ["admin"],
      body: {
        timeMin: "2026-05-01T00:00:00.000Z",
        timeMax: "2026-06-01T00:00:00.000Z",
        timeZone: "America/Toronto",
        calendarId: "primary",
        useSyncCache: true,
      },
    }),
  );
  const body = parseBody(response.body);

  globalThis.fetch = originalFetch;

  assert.equal(response.statusCode, 200);
  assert.equal(body.syncMode, "direct");
  assert.deepEqual(body.items, [
    {
      id: "event-direct-cache",
      title: "Direct Cached Event",
      status: "confirmed",
      htmlLink: "",
      location: "Office",
      description: "",
      eventType: "default",
      visibility: "default",
      start: "2026-05-07T15:00:00.000Z",
      end: "2026-05-07T16:00:00.000Z",
      isAllDay: false,
      organizer: "Admin",
      congregationItems: [],
    },
  ]);

  const storedItems = Array.from(store.values());
  assert.ok(
    storedItems.some((item) => item.pk === syncPk && String(item.sk).startsWith("MONTH#2026-05#")),
  );
});

test("creates a Google calendar event", async () => {
  const originalFetch = globalThis.fetch;
  const connectionData = {
    email: "user@example.com",
    refreshTokenEncrypted: encryptTestSecret("refresh-token"),
    accessTokenEncrypted: encryptTestSecret("access-token"),
    accessTokenExpiresAt: "2999-01-01T00:00:00.000Z",
    connectedAt: "2026-04-26T12:00:00.000Z",
    updatedAt: "2026-04-26T12:05:00.000Z",
    refreshTokenUpdatedAt: "2026-04-26T12:00:00.000Z",
    tokenScope: "https://www.googleapis.com/auth/calendar",
    tokenType: "Bearer",
    lastError: null,
  };
  const dynamo = createMockClient((command) => {
    if (command.constructor.name === "GetCommand") {
      return {
        Item: {
          pk: "CALENDAR_INTEGRATION",
          sk: "GOOGLE#00000000-0000-4000-8000-000000000001",
          data: JSON.stringify(connectionData),
        },
      };
    }

    throw new Error(`Unexpected command ${command.constructor.name}`);
  });

  globalThis.fetch = async () =>
    ({
      ok: true,
      json: async () => ({
        id: "event-2",
        summary: "Booked Event",
        status: "confirmed",
        htmlLink: "https://calendar.google.com/event?eid=123",
        location: "Room A",
        description: "Planning session",
        eventType: "default",
        visibility: "default",
        start: { dateTime: "2026-04-28T14:00:00.000Z" },
        end: { dateTime: "2026-04-28T15:00:00.000Z" },
        organizer: { displayName: "User" },
      }),
    }) as Response;

  setHandlerClientsForTesting({ dynamoClient: dynamo.client });

  const response = await invokeHandler(
    createEvent({
      path: "/calendar/google/events/create",
      method: "POST",
      groups: ["admin"],
      body: {
        calendarId: "primary",
        title: "Booked Event",
        start: "2026-04-28T14:00:00.000Z",
        end: "2026-04-28T15:00:00.000Z",
        timeZone: "America/Toronto",
        location: "Room A",
        description: "Planning session",
        congregationItems: [
          {
            pk: "CONGREGATION",
            sk: "MEMBER#1",
            firstName: "Abouna",
            lastName: "Victor",
            phone: "6135550101",
          },
        ],
      },
    }),
  );
  const body = parseBody(response.body);

  globalThis.fetch = originalFetch;

  assert.equal(response.statusCode, 201);
  assert.equal(body.message, "Google Calendar event created.");
  assert.equal((body.item as { title: string }).title, "Booked Event");
  assert.deepEqual(
    (body.item as { congregationItems: Array<{ sk: string }> }).congregationItems,
    [{ pk: "CONGREGATION", sk: "MEMBER#1", firstName: "Abouna", lastName: "Victor", phone: "6135550101" }],
  );
});

test("updates a Google calendar event", async () => {
  const originalFetch = globalThis.fetch;
  const connectionData = {
    email: "user@example.com",
    refreshTokenEncrypted: encryptTestSecret("refresh-token"),
    accessTokenEncrypted: encryptTestSecret("access-token"),
    accessTokenExpiresAt: "2999-01-01T00:00:00.000Z",
    connectedAt: "2026-04-26T12:00:00.000Z",
    updatedAt: "2026-04-26T12:05:00.000Z",
    refreshTokenUpdatedAt: "2026-04-26T12:00:00.000Z",
    tokenScope: "https://www.googleapis.com/auth/calendar",
    tokenType: "Bearer",
    lastError: null,
  };
  const dynamo = createMockClient((command) => {
    if (command.constructor.name === "GetCommand") {
      return {
        Item: {
          pk: "CALENDAR_INTEGRATION",
          sk: "GOOGLE#00000000-0000-4000-8000-000000000001",
          data: JSON.stringify(connectionData),
        },
      };
    }

    throw new Error(`Unexpected command ${command.constructor.name}`);
  });

  globalThis.fetch = async () =>
    ({
      ok: true,
      json: async () => ({
        id: "event-2",
        summary: "Updated Event",
        status: "confirmed",
        htmlLink: "https://calendar.google.com/event?eid=123",
        location: "Room B",
        description: "Updated planning session",
        eventType: "default",
        visibility: "default",
        start: { dateTime: "2026-04-29T14:00:00.000Z" },
        end: { dateTime: "2026-04-29T15:30:00.000Z" },
        organizer: { displayName: "User" },
      }),
    }) as Response;

  setHandlerClientsForTesting({ dynamoClient: dynamo.client });

  const response = await invokeHandler(
    createEvent({
      path: "/calendar/google/events/update",
      method: "POST",
      groups: ["admin"],
      body: {
        calendarId: "primary",
        eventId: "event-2",
        title: "Updated Event",
        start: "2026-04-29T14:00:00.000Z",
        end: "2026-04-29T15:30:00.000Z",
        timeZone: "America/Toronto",
        location: "Room B",
        description: "Updated planning session",
        congregationItems: [
          {
            pk: "CONGREGATION",
            sk: "MEMBER#2",
            firstName: "Mary",
            lastName: "Zed",
            phone: "6135550202",
          },
        ],
      },
    }),
  );
  const body = parseBody(response.body);

  globalThis.fetch = originalFetch;

  assert.equal(response.statusCode, 200);
  assert.equal(body.message, "Google Calendar event updated.");
  assert.equal((body.item as { title: string }).title, "Updated Event");
  assert.equal((body.item as { description: string }).description, "Updated planning session");
  assert.deepEqual(
    (body.item as { congregationItems: Array<{ sk: string }> }).congregationItems,
    [{ pk: "CONGREGATION", sk: "MEMBER#2", firstName: "Mary", lastName: "Zed", phone: "6135550202" }],
  );
});

test("deletes a Google calendar event", async () => {
  const originalFetch = globalThis.fetch;
  const connectionData = {
    email: "user@example.com",
    refreshTokenEncrypted: encryptTestSecret("refresh-token"),
    accessTokenEncrypted: encryptTestSecret("access-token"),
    accessTokenExpiresAt: "2999-01-01T00:00:00.000Z",
    connectedAt: "2026-04-26T12:00:00.000Z",
    updatedAt: "2026-04-26T12:05:00.000Z",
    refreshTokenUpdatedAt: "2026-04-26T12:00:00.000Z",
    tokenScope: "https://www.googleapis.com/auth/calendar",
    tokenType: "Bearer",
    lastError: null,
  };
  const dynamo = createMockClient((command) => {
    if (command.constructor.name === "GetCommand") {
      return {
        Item: {
          pk: "CALENDAR_INTEGRATION",
          sk: "GOOGLE#00000000-0000-4000-8000-000000000001",
          data: JSON.stringify(connectionData),
        },
      };
    }

    throw new Error(`Unexpected command ${command.constructor.name}`);
  });

  globalThis.fetch = async () =>
    ({
      ok: true,
      json: async () => ({}),
    }) as Response;

  setHandlerClientsForTesting({ dynamoClient: dynamo.client });

  const response = await invokeHandler(
    createEvent({
      path: "/calendar/google/events/delete",
      method: "POST",
      groups: ["admin"],
      body: {
        calendarId: "primary",
        eventId: "event-2",
      },
    }),
  );
  const body = parseBody(response.body);

  globalThis.fetch = originalFetch;

  assert.equal(response.statusCode, 200);
  assert.equal(body.message, "Google Calendar event deleted.");
  assert.equal(body.eventId, "event-2");
});

test("handles the Google Calendar OAuth callback and redirects back to the app", async () => {
  const originalFetch = globalThis.fetch;
  const stateRecord = {
    email: "user@example.com",
    returnTo: "https://app.example.com/calendar/connect",
    createdAt: "2026-04-26T12:00:00.000Z",
    expiresAt: "2999-01-01T00:00:00.000Z",
  };
  let getCount = 0;
  const dynamo = createMockClient((command) => {
    if (command.constructor.name === "GetCommand") {
      getCount += 1;
      return getCount === 1
        ? {
            Item: {
              pk: "CALENDAR_OAUTH_STATE",
              sk: "GOOGLE#oauth-state",
              data: JSON.stringify(stateRecord),
            },
          }
        : {};
    }

    if (command.constructor.name === "PutCommand" || command.constructor.name === "DeleteCommand") {
      return {};
    }

    throw new Error(`Unexpected command ${command.constructor.name}`);
  });

  globalThis.fetch = async () =>
    ({
      ok: true,
      json: async () => ({
        access_token: "new-access-token",
        refresh_token: "new-refresh-token",
        expires_in: 3600,
        scope: "https://www.googleapis.com/auth/calendar",
        token_type: "Bearer",
      }),
    }) as Response;

  setHandlerClientsForTesting({ dynamoClient: dynamo.client });

  const response = await invokeHandler(
    createEvent({
      path: "/calendar/google/oauth/callback",
      queryStringParameters: {
        state: "oauth-state",
        code: "auth-code",
      },
    }),
  );

  globalThis.fetch = originalFetch;

  assert.equal(response.statusCode, 302);
  assert.match(
    String(response.body ?? ""),
    /^$/,
  );
  assert.match(
    String(response.headers?.Location ?? response.headers?.location),
    /^https:\/\/app\.example\.com\/calendar\/connect\?calendar-google-status=success&calendar-google-message=Google\+Calendar\+connected\.$/,
  );
});

test("creates a parking registration", async () => {
  const dynamo = createMockClient((command) => {
    if (command.constructor.name === "QueryCommand") {
      return { Items: [] };
    }

    if (command.constructor.name === "GetCommand") {
      return {
        Item: {
          pk: "PARKING_SETTINGS",
          sk: "CONFIG",
          data: JSON.stringify({
            maxSpots: 10,
            updatedAt: "2026-04-09T10:00:00.000Z",
          }),
        },
      };
    }

    if (command.constructor.name === "PutCommand") {
      return {};
    }

    throw new Error(`Unexpected command ${command.constructor.name}`);
  });
  const ses = createMockClient((command) => {
    assert.equal(command.constructor.name, "SendEmailCommand");
    return {};
  });

  setHandlerClientsForTesting({ dynamoClient: dynamo.client, sesClient: ses.client });

  const response = await invokeHandler(
    createEvent({
      path: "/parking/registration",
      method: "POST",
      body: {
        firstName: "Jane",
        lastName: "Driver",
        licensePlate: "abc 123",
        personalEmail: "jane@example.com",
        workEmail: "jane@work.example.com",
        placeOfWork: "General Hospital",
        cellPhone: "6135550101",
        workPhone: "6135550102",
        durationFrom: "2026-04",
        durationTo: "2026-05",
      },
    }),
  );
  const body = parseBody(response.body);
  const putCommand = dynamo.commands.find(
    (command) => command.constructor.name === "PutCommand",
  );
  const putInput = putCommand?.input as { Item?: Record<string, unknown> };
  const storedData = JSON.parse(String(putInput.Item?.data ?? "{}")) as Record<string, unknown>;

  assert.equal(response.statusCode, 201);
  assert.equal(putInput.Item?.pk, "PARKING_REGISTRATION");
  assert.equal(typeof putInput.Item?.sk, "string");
  assert.equal(storedData.firstName, "Jane");
  assert.equal(storedData.lastName, "Driver");
  assert.equal(storedData.licensePlate, "ABC 123");
  assert.equal(storedData.personalEmail, "jane@example.com");
  assert.equal(storedData.workEmail, "jane@work.example.com");
  assert.equal(storedData.placeOfWork, "General Hospital");
  assert.equal(storedData.cellPhone, "6135550101");
  assert.equal(storedData.workPhone, "6135550102");
  assert.equal(storedData.durationFrom, "2026-04");
  assert.equal(storedData.durationTo, "2026-05");
  assert.equal(storedData.placementStatus, "available");
  assert.equal(typeof storedData.registeredAt, "string");
  assert.deepEqual(storedData.history, [
    {
      timestamp: body.time,
      action: "parking_registration_created",
      message: "Parking registration created and marked as available.",
    },
  ]);
  assert.equal(ses.commands.length, 1);
  assert.equal(
    ((ses.commands[0].input?.Destination as { ToAddresses?: string[] })?.ToAddresses ?? [])[0],
    "jane@example.com",
  );
  assert.equal(
    (ses.commands[0].input?.Content as { Simple?: { Subject?: { Data?: string } } })?.Simple
      ?.Subject?.Data,
    "Parking registration confirmed",
  );
});

test("emails waiting list position for parking registration", async () => {
  const dynamo = createMockClient((command) => {
    if (command.constructor.name === "QueryCommand") {
      return {
        Items: [
          {
            pk: "PARKING_REGISTRATION",
            sk: "REGISTRATION#existing",
            data: JSON.stringify({
              firstName: "Existing",
              lastName: "Driver",
              licensePlate: "XYZ999",
              personalEmail: "existing@example.com",
              workEmail: "",
              placeOfWork: "",
              cellPhone: "6135550000",
              workPhone: "",
              durationFrom: "2026-04",
              durationTo: "2026-06",
              registeredAt: "2026-04-01T08:00:00.000Z",
              placementStatus: "waiting-list",
            }),
          },
          {
            pk: "PARKING_REGISTRATION",
            sk: "REGISTRATION#assigned",
            data: JSON.stringify({
              firstName: "Assigned",
              lastName: "Driver",
              licensePlate: "AAA111",
              personalEmail: "assigned@example.com",
              workEmail: "",
              placeOfWork: "",
              cellPhone: "6135550100",
              workPhone: "",
              durationFrom: "2026-04",
              durationTo: "2026-06",
              registeredAt: "2026-04-01T07:00:00.000Z",
            placementStatus: "available",
            }),
          },
        ],
      };
    }

    if (command.constructor.name === "GetCommand") {
      return {
        Item: {
          pk: "PARKING_SETTINGS",
          sk: "CONFIG",
          data: JSON.stringify({
            maxSpots: 1,
            updatedAt: "2026-04-09T10:00:00.000Z",
          }),
        },
      };
    }

    if (command.constructor.name === "PutCommand") {
      return {};
    }

    throw new Error(`Unexpected command ${command.constructor.name}`);
  });
  const ses = createMockClient((command) => {
    assert.equal(command.constructor.name, "SendEmailCommand");
    return {};
  });

  setHandlerClientsForTesting({ dynamoClient: dynamo.client, sesClient: ses.client });

  const response = await invokeHandler(
    createEvent({
      path: "/parking/registration",
      method: "POST",
      body: {
        firstName: "Wait",
        lastName: "List",
        licensePlate: "wait 123",
        personalEmail: "wait@example.com",
        workEmail: "",
        placeOfWork: "",
        cellPhone: "6135550109",
        workPhone: "",
        durationFrom: "2026-04",
        durationTo: "2026-05",
      },
    }),
  );
  const body = parseBody(response.body);

  assert.equal(response.statusCode, 201);
  assert.equal(
    body.message,
    "Parking registration submitted and added to the waiting list.",
  );
  assert.equal(
    (ses.commands[0].input?.Content as {
      Simple?: { Subject?: { Data?: string }; Body?: { Text?: { Data?: string } } };
    })?.Simple?.Subject?.Data,
    "Parking registration received - waiting list #2",
  );
  assert.match(
    (ses.commands[0].input?.Content as {
      Simple?: { Body?: { Text?: { Data?: string } } };
    })?.Simple?.Body?.Text?.Data ?? "",
    /Waiting list position: 2/,
  );
});

test("blocks parking registration when license plate already exists", async () => {
  const dynamo = createMockClient((command) => {
    if (command.constructor.name === "QueryCommand") {
      return {
        Items: [
          {
            pk: "PARKING_REGISTRATION",
            sk: "REGISTRATION#existing",
            data: JSON.stringify({
              firstName: "Existing",
              lastName: "Driver",
              licensePlate: "ABC123",
              personalEmail: "existing@example.com",
              workEmail: "",
              placeOfWork: "",
              cellPhone: "6135550000",
              workPhone: "",
              durationFrom: "2026-04",
              durationTo: "2026-05",
              registeredAt: "2026-04-01T08:00:00.000Z",
              placementStatus: "waiting-list",
            }),
          },
        ],
      };
    }

    throw new Error(`Unexpected command ${command.constructor.name}`);
  });

  setHandlerClientsForTesting({ dynamoClient: dynamo.client });

  const response = await invokeHandler(
    createEvent({
      path: "/parking/registration",
      method: "POST",
      body: {
        firstName: "Jane",
        lastName: "Driver",
        licensePlate: "ABC 123",
        personalEmail: "jane@example.com",
        workEmail: "",
        placeOfWork: "",
        cellPhone: "6135550101",
        workPhone: "",
        durationFrom: "2026-04",
        durationTo: "2026-05",
      },
    }),
  );
  const body = parseBody(response.body);

  assert.equal(response.statusCode, 409);
  assert.equal(
    body.message,
    "A parking registration already exists for that license plate.",
  );
});

test("blocks parking registration when duration from is not earlier than duration to", async () => {
  const dynamo = createMockClient(() => {
    throw new Error("DynamoDB should not be called for invalid duration.");
  });

  setHandlerClientsForTesting({ dynamoClient: dynamo.client });

  const response = await invokeHandler(
    createEvent({
      path: "/parking/registration",
      method: "POST",
      body: {
        firstName: "Jane",
        lastName: "Driver",
        licensePlate: "ABC 123",
        personalEmail: "jane@example.com",
        workEmail: "",
        placeOfWork: "",
        cellPhone: "6135550101",
        workPhone: "",
        durationFrom: "2026-05",
        durationTo: "2026-05",
      },
    }),
  );
  const body = parseBody(response.body);

  assert.equal(response.statusCode, 400);
  assert.equal(body.message, "Duration from must be earlier than duration to.");
});

test("loads and updates parking management", async () => {
  const dynamo = createMockClient((command) => {
    if (command.constructor.name === "QueryCommand") {
      const values = command.input?.ExpressionAttributeValues as Record<string, string>;
      if (values?.[":pk"] === "CONGREGATION") {
        return {
          Items: [
            {
              pk: "CONGREGATION",
              sk: "MEMBER#parking-admin",
              data: JSON.stringify({
                firstName: "Lot",
                lastName: "Admin",
                email: "lot@example.com",
                role: "parking-admin",
              }),
            },
          ],
        };
      }

      return {
        Items: [
          {
            pk: "PARKING_REGISTRATION",
            sk: "REGISTRATION#1",
            data: JSON.stringify({
              placementStatus: "waiting-list",
            }),
          },
          {
            pk: "PARKING_REGISTRATION",
            sk: "REGISTRATION#2",
            data: JSON.stringify({
              placementStatus: "available",
            }),
          },
        ],
      };
    }

    if (command.constructor.name === "GetCommand") {
      return {
        Item: {
          pk: "PARKING_SETTINGS",
          sk: "CONFIG",
          data: JSON.stringify({
            maxSpots: 50,
            updatedAt: "2026-04-09T10:00:00.000Z",
          }),
        },
      };
    }

    if (command.constructor.name === "PutCommand") {
      return {};
    }

    throw new Error(`Unexpected command ${command.constructor.name}`);
  });

  setHandlerClientsForTesting({ dynamoClient: dynamo.client });

  const getResponse = await invokeHandler({
    ...createEvent({
      path: "/parking/management",
      method: "GET",
    }),
    requestContext: {
      ...createEvent({
        path: "/parking/management",
        method: "GET",
      }).requestContext,
      authorizer: {
        jwt: {
          claims: {
            email: "lot@example.com",
          },
        },
      },
    },
  } as APIGatewayProxyEventV2);
  const getBody = parseBody(getResponse.body);

  assert.equal(getResponse.statusCode, 200);
  assert.equal(getBody.maxSpots, 50);
  assert.equal(getBody.activeRegistrationCount, 1);
  assert.equal(getBody.waitingListCount, 1);

  const postResponse = await invokeHandler({
    ...createEvent({
      path: "/parking/management",
      method: "POST",
      body: { maxSpots: 75 },
    }),
    requestContext: {
      ...createEvent({
        path: "/parking/management",
        method: "POST",
        body: { maxSpots: 75 },
      }).requestContext,
      authorizer: {
        jwt: {
          claims: {
            email: "lot@example.com",
          },
        },
      },
    },
  } as APIGatewayProxyEventV2);
  const postBody = parseBody(postResponse.body);

  assert.equal(postResponse.statusCode, 200);
  assert.equal(postBody.message, "Parking capacity updated.");
});

test("lists parking registrations for parking admin", async () => {
  const dynamo = createMockClient((command) => {
    if (command.constructor.name === "QueryCommand") {
      const values = command.input?.ExpressionAttributeValues as Record<string, string>;
      if (values?.[":pk"] === "CONGREGATION") {
        return {
          Items: [
            {
              pk: "CONGREGATION",
              sk: "MEMBER#parking-admin",
              data: JSON.stringify({
                email: "lot@example.com",
                role: "parking-admin",
              }),
            },
          ],
        };
      }

      return {
        Items: [
          {
            pk: "PARKING_REGISTRATION",
            sk: "REGISTRATION#1",
            data: JSON.stringify({
              firstName: "A",
              lastName: "One",
              registeredAt: "2026-04-01T08:00:00.000Z",
              placementStatus: "waiting-list",
            }),
          },
          {
            pk: "PARKING_REGISTRATION",
            sk: "REGISTRATION#2",
            data: JSON.stringify({
              firstName: "B",
              lastName: "Two",
              registeredAt: "2026-03-01T08:00:00.000Z",
              placementStatus: "available",
            }),
          },
        ],
      };
    }

    throw new Error(`Unexpected command ${command.constructor.name}`);
  });

  setHandlerClientsForTesting({ dynamoClient: dynamo.client });

  const response = await invokeHandler({
    ...createEvent({
      path: "/parking/registrations",
      method: "GET",
    }),
    requestContext: {
      ...createEvent({
        path: "/parking/registrations",
        method: "GET",
      }).requestContext,
      authorizer: {
        jwt: {
          claims: {
            email: "lot@example.com",
          },
        },
      },
    },
  } as APIGatewayProxyEventV2);
  const body = parseBody(response.body) as {
    message: string;
    items: Array<{ sk: string }>;
  };

  assert.equal(response.statusCode, 200);
  assert.equal(body.message, "Parking registrations loaded.");
  assert.equal(body.items[0].sk, "REGISTRATION#2");
  assert.equal(body.items[1].sk, "REGISTRATION#1");
});

test("updates parking registration to available", async () => {
  const dynamo = createMockClient((command) => {
    if (command.constructor.name === "QueryCommand") {
      return {
        Items: [
          {
            pk: "CONGREGATION",
            sk: "MEMBER#parking-admin",
            data: JSON.stringify({
              email: "lot@example.com",
              role: "parking-admin",
            }),
          },
        ],
      };
    }

    if (command.constructor.name === "GetCommand") {
      return {
        Item: {
          pk: "PARKING_REGISTRATION",
          sk: "REGISTRATION#1",
          data: JSON.stringify({
            history: [
              {
                timestamp: "2026-04-01T08:00:00.000Z",
                action: "parking_registration_created",
                message: "Parking registration created and added to the waiting list.",
              },
            ],
            firstName: "Jane",
            lastName: "Driver",
            licensePlate: "ABC123",
            personalEmail: "jane@example.com",
            workEmail: "",
            placeOfWork: "",
            cellPhone: "6135550101",
            workPhone: "",
            durationFrom: "2026-04",
            durationTo: "2026-05",
            registeredAt: "2026-04-01T08:00:00.000Z",
            placementStatus: "waiting-list",
          }),
        },
      };
    }

    if (command.constructor.name === "PutCommand") {
      return {};
    }

    throw new Error(`Unexpected command ${command.constructor.name}`);
  });

  setHandlerClientsForTesting({ dynamoClient: dynamo.client });

  const response = await invokeHandler({
    ...createEvent({
      path: "/parking/registrations/status",
      method: "POST",
      body: {
        sk: "REGISTRATION#1",
        placementStatus: "available",
      },
    }),
    requestContext: {
      ...createEvent({
        path: "/parking/registrations/status",
        method: "POST",
        body: {
          sk: "REGISTRATION#1",
          placementStatus: "available",
        },
      }).requestContext,
      authorizer: {
        jwt: {
          claims: {
            email: "lot@example.com",
          },
        },
      },
    },
  } as APIGatewayProxyEventV2);
  const body = parseBody(response.body);
  const putCommand = dynamo.commands.find(
    (command) => command.constructor.name === "PutCommand",
  );
  const putInput = putCommand?.input as { Item?: Record<string, unknown> };
  const storedData = JSON.parse(String(putInput.Item?.data ?? "{}")) as Record<string, unknown>;

  assert.equal(response.statusCode, 200);
  assert.equal(body.message, "Parking registration marked as available.");
  assert.deepEqual(storedData.history, [
    {
      timestamp: body.time,
      action: "parking_registration_available",
      message: "Parking registration moved to available.",
    },
    {
      timestamp: "2026-04-01T08:00:00.000Z",
      action: "parking_registration_created",
      message: "Parking registration created and added to the waiting list.",
    },
  ]);
});

test("updates parking registration placement status", async () => {
  const dynamo = createMockClient((command) => {
    if (command.constructor.name === "QueryCommand") {
      return {
        Items: [
          {
            pk: "CONGREGATION",
            sk: "MEMBER#parking-admin",
            data: JSON.stringify({
              email: "lot@example.com",
              role: "parking-admin",
            }),
          },
        ],
      };
    }

    if (command.constructor.name === "GetCommand") {
      return {
        Item: {
          pk: "PARKING_REGISTRATION",
          sk: "REGISTRATION#1",
          data: JSON.stringify({
            history: [
              {
                timestamp: "2026-04-01T08:00:00.000Z",
                action: "parking_registration_created",
                message: "Parking registration created and added to the waiting list.",
              },
            ],
            firstName: "Jane",
            lastName: "Driver",
            licensePlate: "ABC123",
            personalEmail: "jane@example.com",
            workEmail: "",
            placeOfWork: "",
            cellPhone: "6135550101",
            workPhone: "",
            durationFrom: "2026-04",
            durationTo: "2026-05",
            registeredAt: "2026-04-01T08:00:00.000Z",
            placementStatus: "waiting-list",
          }),
        },
      };
    }

    if (command.constructor.name === "PutCommand") {
      return {};
    }

    throw new Error(`Unexpected command ${command.constructor.name}`);
  });

  setHandlerClientsForTesting({ dynamoClient: dynamo.client });

  const response = await invokeHandler({
    ...createEvent({
        path: "/parking/registrations/status",
        method: "POST",
        body: {
          sk: "REGISTRATION#1",
          placementStatus: "assigned",
        },
      }),
    requestContext: {
      ...createEvent({
        path: "/parking/registrations/status",
        method: "POST",
        body: {
          sk: "REGISTRATION#1",
          placementStatus: "assigned",
        },
      }).requestContext,
      authorizer: {
        jwt: {
          claims: {
            email: "lot@example.com",
          },
        },
      },
    },
  } as APIGatewayProxyEventV2);
  const body = parseBody(response.body);
  const putCommand = dynamo.commands.find(
    (command) => command.constructor.name === "PutCommand",
  );
  const putInput = putCommand?.input as { Item?: Record<string, unknown> };
  const storedData = JSON.parse(String(putInput.Item?.data ?? "{}")) as Record<string, unknown>;

  assert.equal(response.statusCode, 200);
  assert.equal(body.message, "Parking registration assigned.");
  assert.deepEqual(storedData.history, [
    {
      timestamp: body.time,
      action: "parking_registration_assigned",
      message: "Parking registration moved to assigned.",
    },
    {
      timestamp: "2026-04-01T08:00:00.000Z",
      action: "parking_registration_created",
      message: "Parking registration created and added to the waiting list.",
    },
  ]);
});

test("creates an announcement week", async () => {
  const dynamo = createMockClient((command) => {
    if (command.constructor.name === "GetCommand") {
      return {};
    }

    if (command.constructor.name === "PutCommand") {
      return {};
    }

    throw new Error(`Unexpected command ${command.constructor.name}`);
  });

  setHandlerClientsForTesting({ dynamoClient: dynamo.client });

  const response = await invokeHandler(
    createEvent({
      path: "/announcements/week",
      method: "POST",
      groups: ["admin"],
      body: { weekLabel: "2026-W13", items: [" One ", "", "Two"] },
    }),
  );
  const body = parseBody(response.body);

  assert.equal(response.statusCode, 201);
  assert.equal(body.message, "Announcement week created.");
  assert.equal(body.sk, "WEEK#2026-W13");
  assert.deepEqual(
    dynamo.commands.map((command) => command.constructor.name),
    ["GetCommand", "PutCommand"],
  );
});

test("removes an announcement week", async () => {
  const dynamo = createMockClient((command) => {
    assert.equal(command.constructor.name, "DeleteCommand");
    return {};
  });

  setHandlerClientsForTesting({ dynamoClient: dynamo.client });

  const response = await invokeHandler(
    createEvent({
      path: "/announcements/week/remove",
      method: "POST",
      groups: ["admin"],
      body: { sk: "WEEK#2026-W13" },
    }),
  );
  const body = parseBody(response.body);

  assert.equal(response.statusCode, 200);
  assert.equal(body.message, "Announcement week removed.");
});

test("creates a congregation member", async () => {
  const dynamo = createMockClient((command) => {
    assert.equal(command.constructor.name, "PutCommand");
    return {};
  });

  setHandlerClientsForTesting({ dynamoClient: dynamo.client });

  const response = await invokeHandler(
    createEvent({
      path: "/congregation/member",
      method: "POST",
      groups: ["regular_user"],
      body: {
        firstName: "John",
        lastName: "Smith",
        email: "john@example.com",
        photo: "data:image/jpeg;base64,abc123",
      },
    }),
  );
  const body = parseBody(response.body);
  const putInput = dynamo.commands[0]?.input as { Item?: Record<string, unknown> };

  assert.equal(response.statusCode, 201);
  assert.equal(body.message, "Congregation member created.");
  assert.equal(putInput.Item?.photo, "data:image/jpeg;base64,abc123");
});

test("forbids regular users from creating a priest member", async () => {
  const response = await invokeHandler(
    createEvent({
      path: "/congregation/member",
      method: "POST",
      groups: ["regular_user"],
      body: {
        firstName: "Mark",
        lastName: "Priest",
        role: "Priest",
      },
    }),
  );
  const body = parseBody(response.body);

  assert.equal(response.statusCode, 403);
  assert.equal(body.message, "Only admins can assign the Priest role to a member.");
});

test("imports VCF contacts and skips existing members", async () => {
  const dynamo = createMockClient((command) => {
    if (command.constructor.name === "QueryCommand") {
      return {
        Items: [
          {
            pk: "CONGREGATION",
            sk: "MEMBER#existing",
            data: JSON.stringify({
              firstName: "John",
              lastName: "Smith",
              email: "john@example.com",
              phone: "6137004486",
            }),
          },
        ],
      };
    }

    if (command.constructor.name === "PutCommand") {
      return {};
    }

    throw new Error(`Unexpected command ${command.constructor.name}`);
  });

  setHandlerClientsForTesting({ dynamoClient: dynamo.client });

  const response = await invokeHandler(
    createEvent({
      path: "/contacts/import",
      method: "POST",
      groups: ["admin"],
      body: {
        fileName: "contacts.vcf",
        content: `BEGIN:VCARD
VERSION:3.0
FN:John Smith
N:Smith;John;;;
EMAIL:john@example.com
TEL:6137004486
END:VCARD
BEGIN:VCARD
VERSION:3.0
FN:Jane Doe
N:Doe;Jane;;;
EMAIL:jane@example.com
TEL:+1 (613) 555-0123
ADR:;;123 Example Street;Sample City;ON;A1A 1A1;Canada
NOTE:Imported from phone
END:VCARD`,
      },
    }),
  );
  const body = parseBody(response.body);
  const putInput = dynamo.commands[1]?.input as { Item?: Record<string, unknown> };
  const importedData = JSON.parse(String(putInput.Item?.data ?? "{}")) as Record<
    string,
    unknown
  >;

  assert.equal(response.statusCode, 200);
  assert.equal(body.processedCount, 2);
  assert.equal(body.importedCount, 1);
  assert.equal(body.skippedCount, 1);
  assert.deepEqual(body.importedMembers, ["Jane Doe"]);
  assert.deepEqual(body.skippedMembers, ["John Smith"]);
  assert.deepEqual(
    dynamo.commands.map((command) => command.constructor.name),
    ["QueryCommand", "PutCommand"],
  );
  assert.equal(putInput.Item?.pk, "CONGREGATION");
  assert.equal(typeof putInput.Item?.sk, "string");
  assert.equal(importedData.firstName, "Jane");
  assert.equal(importedData.lastName, "Doe");
  assert.equal(importedData.email, "jane@example.com");
  assert.equal(importedData.phone, "+1 (613) 555-0123");
  assert.equal(
    importedData.address,
    "123 Example Street, Sample City, ON, A1A 1A1, Canada",
  );
  assert.equal(importedData.notes, "Imported from phone");
});

test("updates a congregation member", async () => {
  const existingData = {
    firstName: "John",
    lastName: "Smith",
    history: [],
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  const dynamo = createMockClient((command) => {
    if (command.constructor.name === "GetCommand") {
      return {
        Item: {
          pk: "CONGREGATION",
          sk: "MEMBER#1",
          data: JSON.stringify(existingData),
        },
      };
    }

    if (command.constructor.name === "PutCommand") {
      return {};
    }

    throw new Error(`Unexpected command ${command.constructor.name}`);
  });

  setHandlerClientsForTesting({ dynamoClient: dynamo.client });

  const response = await invokeHandler(
    createEvent({
      path: "/congregation/member/update",
      method: "POST",
      groups: ["regular_user"],
      body: {
        pk: "CONGREGATION",
        sk: "MEMBER#1",
        firstName: "John",
        lastName: "Updated",
        photo: "data:image/jpeg;base64,updated-photo",
      },
    }),
  );
  const body = parseBody(response.body);
  const putCommand = dynamo.commands.find(
    (command) => command.constructor.name === "PutCommand",
  );
  const savedItem = putCommand?.input?.Item as
    | { data: string; photo?: string }
    | undefined;

  assert.equal(response.statusCode, 200);
  assert.equal(body.message, "Congregation member updated.");
  assert.equal(savedItem?.photo, "data:image/jpeg;base64,updated-photo");
});

test("forbids regular users from promoting a member to priest", async () => {
  const dynamo = createMockClient((command) => {
    if (command.constructor.name === "GetCommand") {
      return {
        Item: {
          pk: "CONGREGATION",
          sk: "MEMBER#1",
          data: JSON.stringify({
            firstName: "John",
            lastName: "Smith",
            role: "Member",
            history: [],
            createdAt: "2026-01-01T00:00:00.000Z",
          }),
        },
      };
    }

    throw new Error(`Unexpected command ${command.constructor.name}`);
  });

  setHandlerClientsForTesting({ dynamoClient: dynamo.client });

  const response = await invokeHandler(
    createEvent({
      path: "/congregation/member/update",
      method: "POST",
      groups: ["regular_user"],
      body: {
        pk: "CONGREGATION",
        sk: "MEMBER#1",
        firstName: "John",
        lastName: "Smith",
        role: "Priest",
      },
    }),
  );
  const body = parseBody(response.body);

  assert.equal(response.statusCode, 403);
  assert.equal(body.message, "Only admins can assign the Priest role to a member.");
});

test("removes a congregation member", async () => {
  const dynamo = createMockClient((command) => {
    assert.equal(command.constructor.name, "DeleteCommand");
    return {};
  });

  setHandlerClientsForTesting({ dynamoClient: dynamo.client });

  const response = await invokeHandler(
    createEvent({
      path: "/congregation/member/remove",
      method: "POST",
      groups: ["regular_user"],
      body: { pk: "CONGREGATION", sk: "MEMBER#1" },
    }),
  );
  const body = parseBody(response.body);

  assert.equal(response.statusCode, 200);
  assert.equal(body.message, "Congregation member deleted.");
});

test("schedules a visitation", async () => {
  const dynamo = createMockClient((command, index) => {
    if (command.constructor.name === "GetCommand") {
      if (index === 0) {
        return {
          Item: {
            pk: "CONGREGATION",
            sk: "MEMBER#1",
            data: JSON.stringify({ firstName: "John", lastName: "Smith", visitations: [] }),
          },
        };
      }

      return {
        Item: {
          pk: "CONGREGATION",
          sk: "MEMBER#PRIEST",
          data: JSON.stringify({ firstName: "Paul", lastName: "Priest", role: "Priest" }),
        },
      };
    }

    if (command.constructor.name === "PutCommand") {
      return {};
    }

    throw new Error(`Unexpected command ${command.constructor.name}`);
  });

  setHandlerClientsForTesting({ dynamoClient: dynamo.client });

  const response = await invokeHandler(
    createEvent({
      path: "/congregation/member/visitation",
      method: "POST",
      groups: ["regular_user"],
      body: {
        pk: "CONGREGATION",
        sk: "MEMBER#1",
        action: "schedule",
        schedule: "2026-04-01T10:00:00.000Z",
        assignedPriestSk: "MEMBER#PRIEST",
      },
    }),
  );
  const body = parseBody(response.body);
  const putCommand = dynamo.commands.find(
    (command) => command.constructor.name === "PutCommand",
  );
  const savedItem = putCommand?.input?.Item as { data: string } | undefined;
  const savedData = savedItem ? JSON.parse(savedItem.data) : null;
  const savedVisit = savedData?.visitations?.[0];

  assert.equal(response.statusCode, 200);
  assert.equal(body.message, "Visitation updated.");
  assert.equal(savedVisit?.assignedPriestSk, "MEMBER#PRIEST");
  assert.equal(savedVisit?.assignedPriestName, "Paul Priest");
});

test("rejects assigning a visitation to a non-priest member", async () => {
  const dynamo = createMockClient((command, index) => {
    if (command.constructor.name === "GetCommand") {
      if (index === 0) {
        return {
          Item: {
            pk: "CONGREGATION",
            sk: "MEMBER#1",
            data: JSON.stringify({ firstName: "John", lastName: "Smith", visitations: [] }),
          },
        };
      }

      return {
        Item: {
          pk: "CONGREGATION",
          sk: "MEMBER#2",
          data: JSON.stringify({ firstName: "Sam", lastName: "Servant", role: "Servant" }),
        },
      };
    }

    throw new Error(`Unexpected command ${command.constructor.name}`);
  });

  setHandlerClientsForTesting({ dynamoClient: dynamo.client });

  const response = await invokeHandler(
    createEvent({
      path: "/congregation/member/visitation",
      method: "POST",
      groups: ["regular_user"],
      body: {
        pk: "CONGREGATION",
        sk: "MEMBER#1",
        action: "schedule",
        schedule: "2026-04-01T10:00:00.000Z",
        assignedPriestSk: "MEMBER#2",
      },
    }),
  );
  const body = parseBody(response.body);

  assert.equal(response.statusCode, 400);
  assert.equal(body.message, "Assigned member must be a priest.");
});

test("adds a visitation note to an existing visit", async () => {
  const dynamo = createMockClient((command) => {
    if (command.constructor.name === "GetCommand") {
      return {
        Item: {
          pk: "CONGREGATION",
          sk: "MEMBER#1",
          data: JSON.stringify({
            visitations: [{ id: "visit-1", scheduledAt: "2026-04-01T10:00:00.000Z" }],
          }),
        },
      };
    }

    if (command.constructor.name === "PutCommand") {
      return {};
    }

    throw new Error(`Unexpected command ${command.constructor.name}`);
  });

  setHandlerClientsForTesting({ dynamoClient: dynamo.client });

  const response = await invokeHandler(
    createEvent({
      path: "/congregation/member/visitation",
      method: "POST",
      groups: ["regular_user"],
      body: {
        pk: "CONGREGATION",
        sk: "MEMBER#1",
        action: "note",
        visitationId: "visit-1",
        note: "Bring study material",
      },
    }),
  );
  const body = parseBody(response.body);

  assert.equal(response.statusCode, 200);
  assert.equal(body.message, "Visitation updated.");
});

test("marks a visitation as complete", async () => {
  const dynamo = createMockClient((command) => {
    if (command.constructor.name === "GetCommand") {
      return {
        Item: {
          pk: "CONGREGATION",
          sk: "MEMBER#1",
          data: JSON.stringify({
            visitations: [{ id: "visit-1", scheduledAt: "2026-04-01T10:00:00.000Z" }],
          }),
        },
      };
    }

    if (command.constructor.name === "PutCommand") {
      return {};
    }

    throw new Error(`Unexpected command ${command.constructor.name}`);
  });

  setHandlerClientsForTesting({ dynamoClient: dynamo.client });

  const response = await invokeHandler(
    createEvent({
      path: "/congregation/member/visitation",
      method: "POST",
      groups: ["regular_user"],
      body: {
        pk: "CONGREGATION",
        sk: "MEMBER#1",
        action: "complete",
        visitationId: "visit-1",
      },
    }),
  );
  const body = parseBody(response.body);

  assert.equal(response.statusCode, 200);
  assert.equal(body.message, "Visitation updated.");
});

test("deletes a visitation", async () => {
  const dynamo = createMockClient((command) => {
    if (command.constructor.name === "GetCommand") {
      return {
        Item: {
          pk: "CONGREGATION",
          sk: "MEMBER#1",
          data: JSON.stringify({
            visitations: [
              { id: "visit-1", scheduledAt: "2026-04-01T10:00:00.000Z" },
              { id: "visit-2", scheduledAt: "2026-04-02T10:00:00.000Z" },
            ],
          }),
        },
      };
    }

    if (command.constructor.name === "PutCommand") {
      return {};
    }

    throw new Error(`Unexpected command ${command.constructor.name}`);
  });

  setHandlerClientsForTesting({ dynamoClient: dynamo.client });

  const response = await invokeHandler(
    createEvent({
      path: "/congregation/member/visitation",
      method: "POST",
      groups: ["regular_user"],
      body: {
        pk: "CONGREGATION",
        sk: "MEMBER#1",
        action: "delete",
        visitationId: "visit-1",
      },
    }),
  );
  const body = parseBody(response.body);
  const putCommand = dynamo.commands.find(
    (command) => command.constructor.name === "PutCommand",
  );
  const savedItem = putCommand?.input?.Item as { data: string } | undefined;
  const savedData = savedItem ? JSON.parse(savedItem.data) : null;

  assert.equal(response.statusCode, 200);
  assert.equal(body.message, "Visitation updated.");
  assert.equal(savedData?.visitations?.length, 1);
  assert.equal(savedData?.visitations?.[0]?.id, "visit-2");
});

test("lists announcement weeks", async () => {
  const dynamo = createMockClient((command) => {
    assert.equal(command.constructor.name, "QueryCommand");
    return {
      Items: [
        { pk: "ANNOUNCEMENT", sk: "WEEK#2026-W14", data: "{}" },
        { pk: "ANNOUNCEMENT", sk: "WEEK#2026-W13", data: "{}" },
      ],
    };
  });

  setHandlerClientsForTesting({ dynamoClient: dynamo.client });

  const response = await invokeHandler(
    createEvent({ path: "/announcements", groups: ["regular_user"] }),
  );
  const body = parseBody(response.body);

  assert.equal(response.statusCode, 200);
  assert.equal(body.message, "Announcement weeks loaded.");
  assert.deepEqual(
    body.items,
    [
      { pk: "ANNOUNCEMENT", sk: "WEEK#2026-W13", data: "{}" },
      { pk: "ANNOUNCEMENT", sk: "WEEK#2026-W14", data: "{}" },
    ],
  );
});

test("lists congregation members", async () => {
  const dynamo = createMockClient((command) => {
    assert.equal(command.constructor.name, "QueryCommand");
    return {
      Items: [
        { pk: "CONGREGATION", sk: "MEMBER#2", data: "{}" },
        { pk: "CONGREGATION", sk: "MEMBER#1", data: "{}" },
      ],
    };
  });

  setHandlerClientsForTesting({ dynamoClient: dynamo.client });

  const response = await invokeHandler(
    createEvent({ path: "/congregation/message", groups: ["regular_user"] }),
  );
  const body = parseBody(response.body);

  assert.equal(response.statusCode, 200);
  assert.equal(
    typeof body.message === "string" && body.message.startsWith("Congregation API says hello."),
    true,
  );
  assert.deepEqual(
    body.items,
    [
      { pk: "CONGREGATION", sk: "MEMBER#1", data: "{}" },
      { pk: "CONGREGATION", sk: "MEMBER#2", data: "{}" },
    ],
  );
});

test("loads the congregation directory", async () => {
  const dynamo = createMockClient((command) => {
    assert.equal(command.constructor.name, "QueryCommand");
    return {
      Items: [
        {
          pk: "CONGREGATION",
          sk: "MEMBER#2",
          data: JSON.stringify({ firstName: "Mary", lastName: "Zed", phone: "613-555-0202" }),
        },
        {
          pk: "CONGREGATION",
          sk: "MEMBER#1",
          data: JSON.stringify({
            firstName: "Abouna",
            lastName: "Victor",
            phone: "613-555-0101",
          }),
        },
      ],
    };
  });

  setHandlerClientsForTesting({ dynamoClient: dynamo.client });

  const response = await invokeHandler(
    createEvent({ path: "/congregation/directory", groups: ["regular_user"] }),
  );
  const body = parseBody(response.body);

  assert.equal(response.statusCode, 200);
  assert.equal(body.message, "Congregation directory loaded.");
  assert.deepEqual(body.items, [
    {
      pk: "CONGREGATION",
      sk: "MEMBER#1",
      firstName: "Abouna",
      lastName: "Victor",
      phone: "613-555-0101",
    },
    {
      pk: "CONGREGATION",
      sk: "MEMBER#2",
      firstName: "Mary",
      lastName: "Zed",
      phone: "613-555-0202",
    },
  ]);
});
