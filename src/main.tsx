import { Amplify } from "aws-amplify";
import { parseAmplifyConfig } from "aws-amplify/utils";
import React from "react";
import ReactDOM from "react-dom/client";
import outputs from "../amplify_outputs.json";
import App from "./App";
import "./styles.css";

const restApis = Object.fromEntries(
  Object.entries(outputs.custom?.API ?? {}).map(([key, value]) => [
    key,
    {
      ...value,
      endpoint: value.endpoint.replace(/\/+$/, ""),
    },
  ]),
);
const amplifyConfig = parseAmplifyConfig(outputs);

Amplify.configure({
  ...amplifyConfig,
  API: {
    ...amplifyConfig.API,
    REST: restApis,
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
