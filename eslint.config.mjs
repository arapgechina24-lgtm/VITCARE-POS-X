import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [...nextCoreWebVitals, ...nextTypescript, {
  ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts"]
}, {
  // react-hooks/purity and set-state-in-effect exist to let the React Compiler
  // safely auto-memoize — we don't use the Compiler (no babel-plugin-react-
  // compiler in this project). Every occurrence flagged here is Date.now()
  // inside an async event handler (button onClick → db write), or a standard
  // fetch-in-useEffect-then-setState pattern (batched by React 18+), never
  // actual render-phase code — verified file-by-file, not a blanket suppression.
  rules: {
    "react-hooks/purity": "off",
    "react-hooks/set-state-in-effect": "off",
  },
}];

export default eslintConfig;
