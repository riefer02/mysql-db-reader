import { type XmcpConfig } from "xmcp";

// NOTE: xmcp evaluates this config at BUILD time, so HOST/PORT are baked into
// dist. To change them for a production build:
//   HOST=0.0.0.0 PORT=8080 pnpm build
// For `pnpm dev` they are picked up when the dev server starts.
// xmcp also ships a default `port`, which shadows process.env.PORT at runtime.
const port = Number.parseInt(process.env.PORT ?? "", 10);

const config: XmcpConfig = {
  http: {
    host: process.env.HOST ?? "127.0.0.1",
    ...(Number.isFinite(port) ? { port } : {}),
    // xmcp's effective CORS default is `Access-Control-Allow-Origin: *`, which
    // would let any web page the user visits read data from this local
    // unauthenticated server. Deny browser cross-origin entirely; non-browser
    // MCP clients do not send an Origin header and are unaffected.
    cors: {
      origin: false,
      methods: ["GET", "POST"],
      allowedHeaders: [
        "Content-Type",
        "Authorization",
        "mcp-session-id",
        "mcp-protocol-version",
      ],
    },
  },
  stdio: true,
};

export default config;
