# Shepherd Hub

Workspace for congregation support and visitation planning.

## Included

- Minimal `amplify/` backend
- Email-based Cognito auth resource
- HTTP API backed by a Lambda function
- Basic `ampx` scripts

## Architecture

The application uses a React frontend with Amplify-managed authentication and API routing, backed by a Lambda function and DynamoDB for congregation data.

![Architecture Diagram](public/architecture.png)

## DynamoDB Schema

The backend stores congregation members in a DynamoDB table named `test_table`.

- Partition key: `pk`
- Sort key: `sk`
- Data payload: `data`

For congregation members, the key pattern is:

- `pk`: `CONGREGATION`
- `sk`: `MEMBER#<uuid>`

The `data` attribute is a JSON string. It stores the member profile plus visitation history in this shape:

```json
{
  "firstName": "Daniel",
  "lastName": "Wanis",
  "email": "daniel@example.com",
  "phone": "6130000000",
  "role": "Member",
  "status": "Active",
  "address": "123 Example Street",
  "notes": "General member notes",
  "createdAt": "2026-03-28T12:00:00.000Z",
  "updatedAt": "2026-03-28T14:30:00.000Z",
  "history": [
    {
      "timestamp": "2026-03-28T14:30:00.000Z",
      "action": "member_updated",
      "message": "Member details edited."
    }
  ],
  "visitations": [
    {
      "id": "uuid",
      "scheduledAt": "2026-04-04T13:12:00.000Z",
      "note": "Need it as soon as possible",
      "completedAt": "2026-04-04T15:00:00.000Z",
      "updatedAt": "2026-04-04T15:00:00.000Z"
    }
  ]
}
```

Field notes:

- `history` is an array of audit-style entries used by the member details page log.
- `visitations` is an array because one member can have multiple visits.
- Each visit has its own `id`, so schedule updates, notes, and completion status can be applied to a specific visit.

For weekly announcements, the key pattern is:

- `pk`: `ANNOUNCEMENT`
- `sk`: `WEEK#<uuid>`

The `data` attribute is also a JSON string for announcements. It stores one week of announcement items in this shape:

```json
{
  "weekLabel": "Week of April 7",
  "items": [
    "Board meeting after service",
    "Summer camp registration opens Friday",
    "Parking volunteers needed this weekend"
  ],
  "createdAt": "2026-03-28T12:00:00.000Z",
  "updatedAt": "2026-03-28T14:30:00.000Z"
}
```

Announcement notes:

- each DynamoDB item represents one announcement week
- `weekLabel` is the display label shown in the Announcements page
- `items` is the editable list of announcement strings for that week
- weeks are currently ordered in the UI by descending `sk`

## RBAC

Shepherd Hub uses Amazon Cognito groups for role-based access control.

Configured groups:

- `admin`
- `super_user`
- `regular_user`

Current access model:

- all signed-in users must authenticate with Cognito before the UI is available
- `admin` and `super_user` can access the `User Access` page
- `admin` and `super_user` can assign Cognito users into the supported groups
- the backend also enforces this for the admin user-management API routes, so this is not only a UI restriction

The `User Access` page reads Cognito users from the user pool and allows group assignment for:

- `Admin`
- `Super User`
- `Regular User`

These assignments are stored in Cognito group membership, not in DynamoDB.

## Unit Tests

The Lambda handler has mocked unit tests for all current route handlers.

Files involved:

- test suite: `tests/congregation-message.handler.test.ts`
- test TypeScript config: `tsconfig.lambda-tests.json`
- test script: `npm run test:lambda`

How the tests work:

- the Lambda exports small test helpers that allow the DynamoDB and Cognito clients to be replaced during tests
- the tests use Node's built-in test runner (`node --test`)
- AWS calls are mocked by providing fake `send()` implementations, so no real AWS resources are required
- API Gateway requests are also mocked with in-memory event objects

What is covered:

- congregation list handler
- member create, update, and delete
- visitation schedule, note, and complete actions
- announcements list, create, and delete
- admin user list
- admin group assignment
- RBAC and validation error paths such as missing table config or forbidden access

Run the Lambda unit tests with:

```bash
npm run test:lambda
```

The test script:

1. compiles the backend and test files with `tsconfig.lambda-tests.json`
2. writes the compiled files to `.test-dist/`
3. runs the compiled tests with Node's built-in test runner

These tests are focused on Lambda route logic and mocked AWS interactions. They do not deploy infrastructure and they do not exercise the frontend.

## AWS Setup

1. Install the AWS CLI.

   On macOS with Homebrew:

   ```bash
   brew install awscli
   ```

   Verify the install:

   ```bash
   aws --version
   ```

2. Configure AWS credentials for the target account.

   ```bash
   aws configure
   ```

   Enter:

   - `AWS Access Key ID`
   - `AWS Secret Access Key`
   - `Default region` such as `us-east-1`
   - `Default output format` such as `json`

3. Confirm the CLI is using the expected AWS account.

   ```bash
   aws sts get-caller-identity
   ```

4. Bootstrap the target account and region for CDK asset publishing before running Amplify backend deploys.

   ```bash
   npx cdk bootstrap aws://025890175395/us-east-1
   ```

   Replace `us-east-1` if your Amplify app uses a different region.

## Next Steps

1. Install dependencies:

   ```bash
   npm install
   ```

2. Run the frontend locally:

   ```bash
   npm run dev
   ```

   Open the local URL printed by Vite, usually `http://localhost:5173`.

3. Start the Amplify sandbox backend in a separate terminal:

   ```bash
   npm run ampx:sandbox
   ```

4. Generate Amplify outputs after backend changes so the frontend can discover the API:

   ```bash
   npm run ampx:generate-outputs
   ```

5. Build and preview the production bundle locally if needed:

   ```bash
   npm run build
   npm run preview
   ```

6. Connect the repo in Amplify Hosting when you are ready for CI/CD.

## Notes

- This starter is intentionally minimal.
- The frontend entry point is `src/App.tsx`.
- The Amplify backend includes auth plus a simple Lambda-backed API route for the Congregation page.
- Do not commit AWS access keys or secret credentials to the repository.
