import assert from "node:assert/strict";
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

const invokeHandler = async (event: APIGatewayProxyEventV2) =>
  (await handler(
    event,
    {} as never,
    (() => undefined) as never,
  )) as { statusCode: number; body?: string };

const createEvent = ({
  path,
  method = "GET",
  body,
  groups,
}: {
  path: string;
  method?: "GET" | "POST";
  body?: Record<string, unknown>;
  groups?: string[];
}) =>
  ({
    body: body ? JSON.stringify(body) : undefined,
    headers: {},
    isBase64Encoded: false,
    rawPath: path,
    rawQueryString: "",
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
  resetHandlerClientsForTesting();
});

afterEach(() => {
  resetHandlerClientsForTesting();
  delete process.env.TEST_TABLE_NAME;
  delete process.env.USER_POOL_ID;
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
  assert.deepEqual(body.groupOptions, ["admin", "super_user", "regular_user"]);
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
      },
    }),
  );
  const body = parseBody(response.body);

  assert.equal(response.statusCode, 201);
  assert.equal(body.message, "Congregation member created.");
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
      },
    }),
  );
  const body = parseBody(response.body);

  assert.equal(response.statusCode, 200);
  assert.equal(body.message, "Congregation member updated.");
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
