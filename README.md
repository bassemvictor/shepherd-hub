# Shepherd Hub

Workspace for congregation support and visitation planning.

## Included

- Minimal `amplify/` backend
- Email-based Cognito auth resource
- Basic `ampx` scripts

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

3. Build and preview the production bundle locally if needed:

   ```bash
   npm run build
   npm run preview
   ```

4. Start a sandbox backend:

   ```bash
   npm run ampx:sandbox
   ```

5. Generate outputs when needed:

   ```bash
   npm run ampx:generate-outputs
   ```

6. Connect the repo in Amplify Hosting when you are ready for CI/CD.

## Notes

- This starter is intentionally minimal.
- The frontend entry point is `src/App.tsx`.
- No custom API, Lambda, or DynamoDB resources have been added yet.
