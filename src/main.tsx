import { Amplify } from "aws-amplify";
import React from "react";
import ReactDOM from "react-dom/client";
import outputs from "../amplify_outputs.json";
import App from "./App";
import "./styles.css";

const restApis = outputs.custom?.API ?? {};

if (Object.keys(restApis).length > 0) {
  Amplify.configure({
    API: {
      REST: restApis,
    },
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
